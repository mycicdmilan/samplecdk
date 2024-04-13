import { aws_ec2 as ec2 } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { getEnvName } from "../utils/cdk-utils";
import { Construct } from "constructs";

type IntuSubnetType = "private" | "ingress" | "data";

/*
 * vpcFromContext creates an imported vpc from attributes provided in cdk.json, using sensible intuit-vpc conventions
 * for defaults.
 *
 * @remarks
 * The required structure of cdk.json is to nest vpc information under the appEnv and region. Example:
 * ```json
 * {
 *   'qal': {
 *     'us-west-2': {
 *       'vpcId': 'vpc-12345',                                // required
 *       'availabilityZones': [ 'us-west-2a', 'us-west-2b' ], // required
 *       'privateSubnetIds': [ 'subnet1', 'subnet2'],         // optional, only required for override
 *       'ingressSubnetIds': [ 'subnet1', 'subnet2'],         // optional, only required for override
 *       'dataSubnetIds': [ 'subnet1', 'subnet2'],            // optional, only required for override
 *     }
 *   }
 * }
 * ```
 * If any required values are missing, the returned vpc will be `undefined`. Explicitly provided *SubnetIds entries
 * will take precedence. When missing, CFN imports will be used following the intuit-vpc convention of
 * `${vpcId}:${subnetType}-subnet:ids`.
 *
 * Remember to update your iam-policy.json for the needed ec2 permissions. Also, if you have not already included the
 * @aws-cdk/aws-ec2 module, add it to package.json with npm via:
 *
 * ```shell
 * npm install --save @aws-cdk/aws-ec2@1.147.0
 * ```
 *
 * @returns an Object with vpc, dataSubnets, ingressSubnets, and privateSubnets potentially defined. Use destructuring
 * to take just the values you are interested in. Example:
 * ```ts
 * const { vpc, privateSubnets } = vpcFromContext(scope, 'qal');
 * ```
 */
export function vpcFromContext(
  scope: Construct,
  appEnv: string
): {
  vpc: ec2.IVpc | undefined;
  privateSubnets: ec2.SubnetSelection | undefined;
  ingressSubnets: ec2.SubnetSelection | undefined;
  dataSubnets: ec2.SubnetSelection | undefined;
} {
  const stack = cdk.Stack.of(scope);
  const envCtx = stack.node.tryGetContext(getEnvName(appEnv)) || {};
  const regionCtx = envCtx[stack.region] || {};
  const vpcId: string | undefined = regionCtx["vpcId"];
  const availabilityZones: string[] | undefined =
    regionCtx["availabilityZones"];

  if (!vpcId || !availabilityZones) {
    console.log(
      `WARNING: vpcFromContext: vpcId and availabilityZones must be defined in context for region ${stack.region}`
    );
    return {
      vpc: undefined,
      privateSubnets: undefined,
      ingressSubnets: undefined,
      dataSubnets: undefined,
    };
  }

  const privateSubnets = contextOrImportedSubnetSelection(
    scope,
    regionCtx,
    "private",
    vpcId
  );

  const ingressSubnets = contextOrImportedSubnetSelection(
    scope,
    regionCtx,
    "ingress",
    vpcId
  );

  const dataSubnets = contextOrImportedSubnetSelection(
    scope,
    regionCtx,
    "data",
    vpcId
  );

  const vpc = ec2.Vpc.fromVpcAttributes(scope, vpcId, {
    vpcId,
    availabilityZones,
  });

  return { vpc, privateSubnets, ingressSubnets, dataSubnets };
}

function contextOrImportedSubnetSelection(
  scope: Construct,
  regionContext: any,
  type: IntuSubnetType,
  vpcId: string
): ec2.SubnetSelection {
  const ids: string[] | undefined = regionContext[`${type}SubnetIds`];
  return ids
    ? createSubnetSelection(scope, ids)
    : importSubnetSelectionForType(scope, type, vpcId);
}

export function createSubnetSelection(
  scope: Construct,
  subnetIds: string[]
): ec2.SubnetSelection {
  return {
    subnets: subnetIds.map((id) => ec2.Subnet.fromSubnetId(scope, id, id)),
  };
}

export function importSubnetSelectionForType(
  scope: Construct,
  subnetType: IntuSubnetType,
  vpcId: string
): ec2.SubnetSelection {
  const subnetIds = cdk.Fn.split(
    ",",
    cdk.Fn.importValue(`${vpcId}:${subnetType}-subnet:ids`)
  );

  return {
    subnets: subnetIds.map((id, idx) =>
      ec2.Subnet.fromSubnetId(scope, `${subnetType}${idx}`, id)
    ),
  };
}

export function checkSubnetLength(
  azs: string[] | undefined,
  subnetIds: string[] | undefined
) {
  if (azs && subnetIds) {
    if (azs.length != subnetIds.length) {
      throw new Error("Availability zones and subnets must be of same length");
    }
  }
}
