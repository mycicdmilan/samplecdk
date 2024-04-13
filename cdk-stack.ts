import * as cdk from "aws-cdk-lib";
import { IntuLambdaFn } from "./intu-lambda";
import { vpcFromContext } from "./vpc";
import  * as lambdadata  from "../resource_configs/lambda_config.json"
import { aws_iam as iam } from "aws-cdk-lib";
import {aws_stepfunctions as stepfunctions} from "aws-cdk-lib";
import {aws_stepfunctions_tasks as tasks} from  "aws-cdk-lib";
import {aws_events as events }from "aws-cdk-lib";
import {aws_events_targets as targets} from "aws-cdk-lib";

export interface CdkStackProps extends cdk.StackProps {
  readonly assetId: string;
  readonly gitOrg: string;
  readonly gitRepo: string;
  readonly imageTag: string;
  readonly appEnv: string;
  readonly description?: string;
  readonly environmentVars?: { [key: string]: string};
  readonly availabilityZones?: string[];
  readonly lambdasRequired: string[];
  readonly subnets?: string[];
  readonly vpcId?: string;
}

/*
 * Sample stack on how a developer would use the IntuLambda construct.
 */
export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: CdkStackProps) {
    super(scope, id, props);

    const appEnv = props.appEnv;
    const { vpc, privateSubnets } = vpcFromContext(this, appEnv);
    const lambdasRequired = props.lambdasRequired

   
    const function_name = Object.keys(lambdadata)
    type LambdaNameType = typeof function_name[number]
    type LambdaFnsType = { [key in LambdaNameType]: IntuLambdaFn}
    type lambdaFnsConfigType = { [key in LambdaNameType]: { name: string, code: string, timeout: number, memsize: number, runtime: string, lambdaRole: string | null, lambdaHandler: string, env_var:{[key: string]: string}} };
    const lambdaFnConfig: lambdaFnsConfigType = lambdadata
    let lambdaRole: iam.IRole = iam.Role.fromRoleArn(this,'Role',`arn:aws:iam::${props.env?.account}:role/${props.environmentVars?.lambda_iamrole}`);
    let assignedLambdaRole = lambdaRole
    
    const functions = Object.fromEntries(
      function_name.map((fnName: LambdaNameType) => {

        if (!lambdasRequired.includes(lambdaFnConfig[fnName].name)) {
          console.log(lambdaFnConfig[fnName].name);
          return [undefined, undefined]
        }
        
        var environment_variables = Object.assign({}, props.environmentVars, lambdaFnConfig[fnName].env_var);
        if (lambdaFnConfig[fnName].lambdaRole != null)
          assignedLambdaRole = iam.Role.fromRoleArn(this,'role-'+lambdaFnConfig[fnName].lambdaRole,`arn:aws:iam::${props.env?.account}:role/${lambdaFnConfig[fnName].lambdaRole}`)
        
        let fn = new IntuLambdaFn(this, lambdaFnConfig[fnName].name, {
          functionName: lambdaFnConfig[fnName].name,
          assetId: props.assetId,
          timeout: cdk.Duration.seconds(lambdaFnConfig[fnName].timeout),
          role: lambdaFnConfig[fnName].lambdaRole === null ? lambdaRole : assignedLambdaRole,
          gitOrg: props.gitOrg,
          gitRepo: props.gitRepo,
          imageTag: props.imageTag,
          memorySize: lambdaFnConfig[fnName].memsize,
          description: props.description,
          vpcSubnets: privateSubnets,
          vpc,
          appEnv,
          environment: environment_variables
        });
        return [fnName, fn];
    })
    ) as LambdaFnsType

    const AwsAccountClose = new tasks.LambdaInvoke(this, 'close_account_task', {
      lambdaFunction: functions['FUNC_CLOSE_AWS_ACCOUNT'],
      // Lambda's result is in the attribute `Payload`
      //outputPath: '$.payload',
      inputPath: '$.Payload'
    });
    const MoveToSuspend = new tasks.LambdaInvoke(this, 'move_to_suspended_task', {
      lambdaFunction: functions['FUNC_MOVE_TO_SUSPENDED'],
      // Lambda's result is in the attribute `Payload`
      //outputPath: '$.payload',
    });
     const OrgAccountStatus = new tasks.LambdaInvoke(this, 'check_org_account_status_task', {
      lambdaFunction: functions['FUNC_CHECK_ORG_ACCOUNT_STATUS'],
      inputPath: '$.Payload'
      // Lambda's result is in the attribute `Payload`
      //outputPath: '$.payload',
    });
    // Add Retry to close account
    AwsAccountClose.addRetry({ errors:['States.Timeout'],maxAttempts: 1 , backoffRate: 2, interval: cdk.Duration.seconds(10)})
  
    const wait = new stepfunctions.Wait(this, 'Wait_Seconds_task', {
      /**
       *  Error handling
       */
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(30)),
    });
    const offboardDevportal = new tasks.LambdaInvoke(this, 'Offboard_from_devportal_task', {
      lambdaFunction: functions['FUNC_OFFBOARD_FROM_DEVELOPER_SERVICE'],
      inputPath: '$.Payload'
      //outputPath: '$.payload',
      //resultPath: '$.result'
    });
    const OffboardStackSet = new tasks.LambdaInvoke(this, 'Offboard_from_stackset_task', {
      lambdaFunction: functions['FUNC_OFFBOARD_FROM_STACKSET'],
      inputPath: '$.Payload'
      //outputPath: '$.payload',
      //resultPath: '$.result'
    });
    const offboardOil = new tasks.LambdaInvoke(this, 'Offboard_from_OIL_task', {
      lambdaFunction: functions['FUNC_OFFBOARD_FROM_OIL'],
      inputPath: '$.Payload'
      //outputPath: '$.payload',
      //resultPath: '$.result'
    });
    const Statushandler = new tasks.LambdaInvoke(this, 'status_handler_task', {
      lambdaFunction: functions['FUNC_STATUS_HANDLER'],
      inputPath: '$.Payload'
    });
  
    const waitX = new stepfunctions.Wait(this, 'Wait_X_Seconds', {
      /**
       *  Error handling
       */
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(10)),
    });
    const waitY = new stepfunctions.Wait(this, 'Wait_Y_Seconds', {
      /**
       *  Error handling
       */
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(10)),
    });
    const parallel = new stepfunctions.Parallel(this, 'dependent_service_offboarding',
      {
      //inputPath: '$.Payload',
      resultSelector: {
      "Payload":{
     "sf_status": {
      "move_to_suspended-e2e": stepfunctions.JsonPath.stringAt("$.[0].Payload.sf_status.move_to_suspended"),
      "close_aws_account": stepfunctions.JsonPath.stringAt("$.[0].Payload.sf_status.close_aws_account"),
      "check_org_account_status-e2e": stepfunctions.JsonPath.stringAt("$.[0].Payload.sf_status.check_org_account_status"),
      "offboard_from_oil": stepfunctions.JsonPath.stringAt("$.[0].Payload.sf_status.offboard_from_oil"),
      "offboard_from_developer_service": stepfunctions.JsonPath.stringAt("$.[1].Payload.sf_status.offboard_from_developer_service"),
      "offboard_from_stackset": stepfunctions.JsonPath.stringAt("$.[2].Payload.sf_status.offboard_from_stackset")
  },
  "account_id": stepfunctions.JsonPath.stringAt("$.[0].Payload.account_id")}},
      resultPath: '$.TaskResult',
      outputPath: '$.TaskResult'});
  
      parallel.branch(offboardOil);
      parallel.branch(offboardDevportal);
      parallel.branch(OffboardStackSet);
  
    const passEnd = new stepfunctions.Pass(this , 'endflow')
  
    const choice4 = new stepfunctions.Choice(this, 'Account not suspended')
                        .when(stepfunctions.Condition.numberLessThan('$.Payload.check_status_retry_count', 5), waitX.next(OrgAccountStatus))
                        .otherwise(Statushandler)
  
    const choice3 = new stepfunctions.Choice(this, 'Account Suspended updated in Org ?')
                        .when(stepfunctions.Condition.booleanEquals('$.Payload.sf_status.check_org_account_status', true),parallel.next(Statushandler))
                        .when(stepfunctions.Condition.booleanEquals('$.Payload.sf_status.check_org_account_status', false),choice4)
    const choice2 = new stepfunctions.Choice(this, 'Account Closed or not ?')
                  .when(stepfunctions.Condition.booleanEquals('$.Payload.sf_status.close_aws_account', true), waitY.next(OrgAccountStatus).next(choice3))
                  .when(stepfunctions.Condition.booleanEquals('$.Payload.sf_status.close_aws_account', false), Statushandler)
  
    const choice1 = new stepfunctions.Choice(this, 'Move to suspended OU?')
                        .when(stepfunctions.Condition.booleanEquals('$.Payload.sf_status.move_to_suspended', true), AwsAccountClose.next(choice2))
                        .otherwise(Statushandler)
  
  
    const definition = MoveToSuspend.next(choice1)
  
        const stateMachine = new stepfunctions.StateMachine(this, 'aws-account-closure', {
          stateMachineName : `aws-account-closure-${props.appEnv}`,
          definition,
          timeout: cdk.Duration.minutes(5),
        });
  
    // const rule = new events.Rule(this, 'aws-account-closure-rule', {
    //       schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
    //       ruleName: 'aws-account-closure-rule',
    //       });
    
    // rule.addTarget(new targets.LambdaFunction(functions['FUNC_GET_ORG_ACCOUNT_LIST']));

    
    
/*
    new IntuLambdaFn(this, 'AppLambda', {
      functionName: undefined,
      assetId: props.assetId,
      gitOrg: props.gitOrg,
      gitRepo: props.gitRepo,
      imageTag: props.imageTag,
      memorySize: 512,
      description: props.description,
      vpcSubnets: privateSubnets,
      vpc,
      appEnv,
      environment: props.environmentVars,
    });
    */
  }
}
