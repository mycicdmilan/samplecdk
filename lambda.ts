import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as cdk from "aws-cdk-lib";
import { aws_codeguruprofiler as cgp } from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_ecr as ecr } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_kms as kms } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_logs as logs } from "aws-cdk-lib";
import { aws_sqs as sqs } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  IntuitOil,
  IntuitOilBusinessUnit,
  IntuitOilEnvironment,
} from "@intuit-cdk/oil";
import { IntuitOim, IntuitOimProps } from "@intuit-cdk/oim";
import { getEnvName } from "../utils/cdk-utils";

export interface IntuLambdaFnProps {
  appEnv: string;
  assetId: string;
  imageTag: string;
  gitOrg: string;
  gitRepo: string;
  currentVersionOptions?: lambda.VersionOptions;
  deadLetterQueue?: sqs.IQueue;
  deadLetterQueueEnabled?: boolean;
  description?: string;
  ecrRepo?: ecr.IRepository;
  environment?: { [key: string]: string };
  environmentEncryption?: kms.IKey;
  events?: lambda.IEventSource[];
  filesystem?: lambda.FileSystem;
  functionName?: string;
  initialPolicy?: iam.PolicyStatement[];
  layers?: lambda.ILayerVersion[];
  logRetention?: logs.RetentionDays;
  logRetentionRetryOptions?: lambda.LogRetentionRetryOptions;
  logRetentionRole?: iam.IRole;
  maxEventAge?: cdk.Duration;
  memorySize?: number;
  onFailure?: lambda.IDestination;
  onSuccess?: lambda.IDestination;
  profiling?: boolean;
  profilingGroup?: cgp.IProfilingGroup;
  reservedConcurrentExecutions?: number;
  retryAttempts?: number;
  role?: iam.IRole;
  securityGroups?: ec2.ISecurityGroup[];
  timeout?: cdk.Duration;
  tracing?: lambda.Tracing;
  vpc?: ec2.IVpc;
  vpcSubnets?: ec2.SubnetSelection;
  oim?: IntuitOimProps;
  oil?: {
    enabled?: boolean;
    businessUnit?: IntuitOilBusinessUnit;
    environment?: IntuitOilEnvironment;
    index?: string;
  };
}

export class IntuLambdaFn extends lambda.DockerImageFunction {
  /**
   * Set defaults for the Lambda construct props, but gives the option to be overridden.
   */
  private static lambdaFunctionProps(
    scope: Construct,
    props: IntuLambdaFnProps
  ): lambda.DockerImageFunctionProps {
    const standardEnv = {
      VERSION: props.imageTag,
      ENVIRONMENT: props.appEnv,
    };

    const environment = Object.assign(standardEnv, props.environment || {});

    const envQualifiedFunctionName = props.functionName
      ? `${props.functionName}-${props.assetId}-${props.appEnv}`
      : undefined;

    const ecrRepoName = genEcrRepoName(props);

    const repo =
      props.ecrRepo ??
      ecr.Repository.fromRepositoryName(
        scope,
        `${props.functionName || "Root"}FunctionEcrRepo`,
        ecrRepoName
      );
    const fromEcrProps = { tagOrDigest: props.imageTag };

    return {
      code: lambda.DockerImageCode.fromEcr(repo, fromEcrProps),
      currentVersionOptions: props.currentVersionOptions,
      deadLetterQueue: props.deadLetterQueue,
      deadLetterQueueEnabled: props.deadLetterQueueEnabled,
      description: props.description,
      environment,
      environmentEncryption: props.environmentEncryption,
      events: props.events,
      filesystem: props.filesystem,
      functionName: envQualifiedFunctionName,
      initialPolicy: props.initialPolicy,
      layers: props.layers,
      logRetention: props.logRetention || logs.RetentionDays.ONE_WEEK,
      logRetentionRetryOptions: props.logRetentionRetryOptions,
      logRetentionRole: props.logRetentionRole,
      maxEventAge: props.maxEventAge,
      memorySize: props.memorySize,
      onFailure: props.onFailure,
      onSuccess: props.onSuccess,
      profiling: props.profiling,
      profilingGroup: props.profilingGroup,
      reservedConcurrentExecutions: props.reservedConcurrentExecutions,
      retryAttempts: props.retryAttempts,
      role: props.role,
      securityGroups: props.securityGroups,
      timeout: props.timeout || cdk.Duration.seconds(30),
      tracing: props.tracing,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
    };
  }

  constructor(scope: Construct, id: string, props: IntuLambdaFnProps) {
    const lambdaProps = IntuLambdaFn.lambdaFunctionProps(scope, props);
    super(scope, id, lambdaProps);

    new IntuitOim(this, "Oim", props.oim);

    new IntuitOil(this, "Oil", {
      appEnv: getEnvName(props.appEnv),
      logGroupName: this.logGroup.logGroupName,
      ...props.oil,
    });
  }
}

function genEcrRepoName(props: IntuLambdaFnProps) {
  const imageMappingsFile = path.join(__dirname, "..", "image-mappings.yaml")
  const mappingsPresent = fs.existsSync(imageMappingsFile);

  if (!mappingsPresent && props?.functionName === undefined) {
    return `${props.gitOrg}/${props.gitRepo}`;
  }

  const imageMappingsYaml = yaml.load(
      fs.readFileSync(imageMappingsFile, "utf-8")
  ) as any;

  // Look in local and external for the function name as a key.
  // If present, ECR repo is the extended version with /functionName. If not, ECR repo is root.
  if (
      (isFunctionNameExistsInMappings(imageMappingsYaml.local, props.functionName || '')) ||
      (isFunctionNameExistsInMappings(imageMappingsYaml.external, props.functionName || ''))) {
    return `${props.gitOrg}/${props.gitRepo}/${props.functionName}`;
  }
  return `${props.gitOrg}/${props.gitRepo}`;
}

function isFunctionNameExistsInMappings(mappings: Map<string, string>[], functionName: string) {
  if (!mappings) {
    return false
  }

  for (const img of mappings) {
    const imgMap = new Map(Object.entries(img));
    if (imgMap.get("name") === functionName) {
      return true;
    }
  }
  return false;
}
