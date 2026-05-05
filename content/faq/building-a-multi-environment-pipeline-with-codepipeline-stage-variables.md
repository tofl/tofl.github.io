---
title: "Building a Multi-Environment Pipeline with CodePipeline Stage Variables"
---

## Building a Multi-Environment Pipeline with CodePipeline Stage Variables

Imagine you've just finished building a robust deployment pipeline for your application. It works beautifully for development. But now you need to deploy to staging and production. Do you duplicate the entire pipeline three times, changing bucket names, instance targets, and approval gates each time? Do you hardcode environment-specific values throughout your pipeline configuration? Neither approach is sustainable.

This is where AWS CodePipeline stage variables become invaluable. They allow you to parameterize your entire pipeline, enabling a single, reusable pipeline definition that adapts dynamically to different environments. Rather than managing three separate pipelines with duplicated logic, you define variables once and reference them throughout your pipeline stages—in CloudFormation templates, CodeBuild jobs, and Lambda functions. This approach not only reduces maintenance burden but also ensures consistency across environments and makes your infrastructure more scalable.

In this article, we'll explore how to leverage stage variables to build sophisticated, multi-environment deployment pipelines that scale from a single dev environment to complex production setups.

### Understanding Stage Variables and Why They Matter

Stage variables are pipeline-level parameters that you define once and reference throughout your pipeline configuration. Think of them as environment-specific configuration that flows through your entire deployment process. Each stage in your pipeline can have its own set of variables, allowing you to customize behavior without changing the underlying pipeline definition.

The power of stage variables lies in their simplicity and flexibility. Rather than embedding environment-specific values directly into your pipeline, you declare them at the stage level. Then, whenever you need to reference an environment-specific value—whether it's an S3 bucket name, a deployment target, or a parameter for CloudFormation—you use a substitution token like `#{VariableName}`. CodePipeline interpolates these tokens with the actual values before executing the stage.

This becomes especially valuable when you're managing multiple environments. A typical organization might have development, staging, and production environments with different infrastructure requirements, approval workflows, and artifact storage locations. With stage variables, you can maintain a single pipeline definition while allowing each stage to behave differently based on its environment context.

### Defining Stage Variables in Your Pipeline

Stage variables are defined at the stage level within your CodePipeline configuration. You can set them through the AWS Management Console, the AWS CLI, or Infrastructure as Code tools like AWS CloudFormation or Terraform.

Let's walk through a concrete example. Suppose you're deploying a microservice that needs different target environments. Your pipeline has three stages: Dev, Staging, and Prod. Each stage needs to know its target deployment environment, artifact bucket, and approval requirements.

Through the AWS Console, you'd navigate to your pipeline settings and configure the stage variables for each stage. For the Dev stage, you might set variables like:

```
EnvironmentName: development
ArtifactBucket: my-artifacts-dev
DeploymentStackName: myapp-dev
InstanceProfile: myapp-dev-role
```

For the Staging stage:

```
EnvironmentName: staging
ArtifactBucket: my-artifacts-staging
DeploymentStackName: myapp-staging
InstanceProfile: myapp-staging-role
```

And for Prod:

```
EnvironmentName: production
ArtifactBucket: my-artifacts-prod
DeploymentStackName: myapp-prod
InstanceProfile: myapp-prod-role
RequiresApproval: true
```

If you prefer infrastructure as code, you can define these variables in your CloudFormation template or using the AWS CLI. Here's how you might structure it using the AWS CLI to update an existing pipeline:

```bash
aws codepipeline get-pipeline --name my-deployment-pipeline > pipeline.json
# Edit pipeline.json to add stage variables
aws codepipeline update-pipeline --cli-input-json file://pipeline.json
```

The pipeline JSON structure includes stages, and within each stage, you can add a `variables` section. The key insight is that these variables are defined at the stage level, not at the pipeline level, allowing different stages to have different configurations.

### Accessing Stage Variables in CloudFormation

One of the most common uses for stage variables is parameterizing CloudFormation deployments. When CodePipeline executes a CloudFormation action, it can pass stage variables as CloudFormation parameter values. This allows your infrastructure as code to remain generic while adapting to different environments.

Suppose you have a CloudFormation template that deploys an EC2 instance. The template accepts a parameter for the environment name and uses it to tag resources and configure environment-specific settings. Your template might look like this:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Application deployment template

Parameters:
  EnvironmentName:
    Type: String
    Description: The environment where this is being deployed
  InstanceType:
    Type: String
    Default: t3.micro
    Description: EC2 instance type to use
  ApplicationVersion:
    Type: String
    Description: Version of the application to deploy

Resources:
  ApplicationInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-0c55b159cbfafe1f0
      InstanceType: !Ref InstanceType
      IamInstanceProfile: !Sub 'myapp-${EnvironmentName}-role'
      Tags:
        - Key: Name
          Value: !Sub 'myapp-${EnvironmentName}'
        - Key: Environment
          Value: !Ref EnvironmentName
        - Key: Version
          Value: !Ref ApplicationVersion

Outputs:
  InstanceId:
    Value: !Ref ApplicationInstance
    Export:
      Name: !Sub '${EnvironmentName}-instance-id'
```

In your CodePipeline configuration, when you add a CloudFormation deployment action, you specify the parameter overrides. This is where stage variables come into play. Instead of hardcoding values, you use the substitution syntax `#{VariableName}`:

```json
{
  "ActionTypeId": {
    "Category": "Deploy",
    "Owner": "AWS",
    "Provider": "CloudFormation",
    "Version": "1"
  },
  "Configuration": {
    "ActionMode": "CHANGE_SET_REPLACE",
    "StackName": "#{DeploymentStackName}",
    "ChangeSetName": "#{DeploymentStackName}-changeset",
    "TemplatePath": "SourceOutput::packaged-template.yaml",
    "Capabilities": "CAPABILITY_IAM,CAPABILITY_NAMED_IAM",
    "ParameterOverrides": "{\"EnvironmentName\":\"#{EnvironmentName}\",\"ApplicationVersion\":\"#{ApplicationVersion}\"}"
  },
  "InputArtifacts": [
    {
      "Name": "SourceOutput"
    }
  ]
}
```

When CodePipeline executes this action in the Dev stage, it substitutes `#{EnvironmentName}` with the value `development` that you defined in the Dev stage variables. In the Prod stage, the same action automatically uses `production`. This single action definition serves all your environments.

### Leveraging Stage Variables in CodeBuild

CodeBuild is another powerful integration point for stage variables. When CodeBuild is used within a CodePipeline, you can pass stage variables as environment variables to your build container. This allows your build scripts and deployment logic to adapt based on the target environment.

Consider a scenario where your build process needs to publish artifacts to different S3 buckets for different environments. Your CodeBuild project uses a buildspec file that includes environment variable references. The buildspec might look like this:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      python: 3.11
  build:
    commands:
      - echo "Building for environment $ENVIRONMENT_NAME"
      - pip install -r requirements.txt
      - python -m pytest
      - python -m py_compile src/
      - |
        aws s3 cp dist/myapp.jar \
          s3://$ARTIFACT_BUCKET/$BUILD_NUMBER/myapp.jar \
          --region us-east-1
  post_build:
    commands:
      - echo "Build completed for $ENVIRONMENT_NAME"

artifacts:
  files:
    - dist/**/*
    - packaged-template.yaml
```

In your CodePipeline configuration, when you add a CodeBuild action, you specify environment variable overrides using stage variables:

```json
{
  "ActionTypeId": {
    "Category": "Build",
    "Owner": "AWS",
    "Provider": "CodeBuild",
    "Version": "1"
  },
  "Configuration": {
    "ProjectName": "my-build-project",
    "EnvironmentVariables": "[{\"name\":\"ENVIRONMENT_NAME\",\"value\":\"#{EnvironmentName}\"},{\"name\":\"ARTIFACT_BUCKET\",\"value\":\"#{ArtifactBucket}\"},{\"name\":\"DEPLOYMENT_TARGET\",\"value\":\"#{DeploymentTarget}\"}]"
  }
}
```

When your CodeBuild container executes, it has access to these environment variables with values interpolated from the stage variables. This means your build script can dynamically configure its behavior based on which stage is running it.

### Implementing Approval Gates with Stage Variables

A common pattern in multi-environment pipelines is to require manual approval before deploying to production while allowing automatic deployment to development and staging. Stage variables enable this pattern elegantly.

You can use stage variables to control whether an approval action is included in a particular stage, or more directly, you can structure your pipeline so that the approval action is only present in your production stage. However, a more flexible approach is to use stage variables in conjunction with Lambda functions that decide whether approval is needed based on the environment.

Here's a practical example: You might use a Lambda function as a custom approval gate for production deployments. Your Lambda function can examine the stage variables and enforce additional validation rules specific to production. The function might verify that code has been reviewed, that tests passed with a certain coverage threshold, or that specific tags are present on the source commit.

A simple Lambda function for this might look like:

```python
import json
import boto3

codepipeline = boto3.client('codepipeline')

def lambda_handler(event, context):
    job_id = event['CodePipeline.job']['id']
    
    try:
        # In a real scenario, you'd extract stage variables
        # from the job details and perform environment-specific checks
        
        # Example: Only allow deployments if certain conditions are met
        approval_status = validate_deployment_readiness()
        
        if approval_status['approved']:
            codepipeline.put_job_success_result(jobId=job_id)
        else:
            codepipeline.put_job_failure_result(
                jobId=job_id,
                failureDetails={'message': approval_status['reason']}
            )
    except Exception as e:
        codepipeline.put_job_failure_result(
            jobId=job_id,
            failureDetails={'message': str(e)}
        )

def validate_deployment_readiness():
    # Implement your validation logic here
    return {'approved': True}
```

While this example shows a Lambda-based approach, the core principle remains: stage variables allow you to express different deployment logic for different environments without duplicating your pipeline infrastructure.

### A Complete Multi-Environment Pipeline Example

Let's tie everything together with a realistic end-to-end scenario. Imagine you're deploying a containerized application across three environments: development, staging, and production.

Your pipeline source stage pulls code from a repository. This flows into a build stage that runs tests and creates a Docker image. Then comes a deploy-to-dev stage, followed by a deploy-to-staging stage, and finally a deploy-to-prod stage with an approval gate.

For the build stage, you'd define minimal variables since building is largely environment-agnostic:

```
BuildEnvironment: dev
CodeCommitRepo: my-app-repo
```

For the dev deployment stage:

```
EnvironmentName: development
DeploymentStackName: myapp-dev
ECSClusterName: myapp-dev-cluster
ECSServiceName: myapp-dev-service
ECRRepositoryUri: 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp-dev
ApprovalRequired: false
DesiredCount: 1
```

For staging:

```
EnvironmentName: staging
DeploymentStackName: myapp-staging
ECSClusterName: myapp-staging-cluster
ECSServiceName: myapp-staging-service
ECRRepositoryUri: 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp-staging
ApprovalRequired: false
DesiredCount: 2
```

And for production:

```
EnvironmentName: production
DeploymentStackName: myapp-prod
ECSClusterName: myapp-prod-cluster
ECSServiceName: myapp-prod-service
ECRRepositoryUri: 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp-prod
ApprovalRequired: true
DesiredCount: 3
```

Your CloudFormation template for ECS deployment might accept these parameters:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: ECS service deployment template

Parameters:
  EnvironmentName:
    Type: String
  ECSClusterName:
    Type: String
  ECSServiceName:
    Type: String
  ImageUri:
    Type: String
  DesiredCount:
    Type: Number

Resources:
  TaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: !Sub '${ECSServiceName}-task'
      NetworkMode: awsvpc
      RequiresCompatibilities:
        - FARGATE
      Cpu: 256
      Memory: 512
      ContainerDefinitions:
        - Name: app
          Image: !Ref ImageUri
          Essential: true
          PortMappings:
            - ContainerPort: 8080
          LogConfiguration:
            LogDriver: awslogs
            Options:
              awslogs-group: !Sub '/ecs/${ECSServiceName}'
              awslogs-region: !Ref AWS::Region
              awslogs-stream-prefix: ecs

  Service:
    Type: AWS::ECS::Service
    Properties:
      ServiceName: !Ref ECSServiceName
      Cluster: !Ref ECSClusterName
      TaskDefinition: !Ref TaskDefinition
      DesiredCount: !Ref DesiredCount
      LaunchType: FARGATE
      NetworkConfiguration:
        AwsvpcConfiguration:
          AssignPublicIp: ENABLED
          Subnets:
            - subnet-12345678
          SecurityGroups:
            - sg-12345678
```

In your CodePipeline deploy action configuration, you pass stage variables as parameter overrides:

```json
{
  "ActionTypeId": {
    "Category": "Deploy",
    "Owner": "AWS",
    "Provider": "CloudFormation",
    "Version": "1"
  },
  "Configuration": {
    "ActionMode": "CHANGE_SET_REPLACE",
    "StackName": "#{DeploymentStackName}",
    "ChangeSetName": "#{DeploymentStackName}-changeset",
    "TemplatePath": "BuildOutput::packaged-template.yaml",
    "Capabilities": "CAPABILITY_IAM,CAPABILITY_NAMED_IAM",
    "ParameterOverrides": "{\"EnvironmentName\":\"#{EnvironmentName}\",\"ECSClusterName\":\"#{ECSClusterName}\",\"ECSServiceName\":\"#{ECSServiceName}\",\"ImageUri\":\"#{ECRRepositoryUri}:#{BUILD_ID}\",\"DesiredCount\":\"#{DesiredCount}\"}"
  }
}
```

Notice how `#{BUILD_ID}` is also available—CodePipeline provides several built-in variables that you can reference alongside your custom stage variables. Others include `#{codepipeline.PipelineExecutionId}` and `#{codepipeline.PipelineVersion}`.

### Best Practices for Stage Variables

As you implement multi-environment pipelines with stage variables, several practices will help you avoid common pitfalls and maintain a robust, scalable system.

First, name your variables clearly and consistently. Use descriptive names that immediately convey their purpose and environment. Avoid ambiguous abbreviations. `ECSClusterName` is far clearer than `ClusterN` or `C_Name`. This clarity becomes especially important when others on your team need to understand and modify the pipeline.

Second, document the expected values and format for each variable. Create a reference table or inline documentation within your pipeline definition that specifies what values each variable should contain and why. This prevents confusion and makes onboarding new team members much easier.

Third, validate stage variable values early in your pipeline. If a variable contains an invalid value, catching it in the first stage prevents wasted compute and time. You can use a simple Lambda function or CodeBuild step that validates all required variables exist and have reasonable values before proceeding.

Fourth, use consistent patterns across stages. If you're using a certain naming convention for CloudFormation stacks in development, apply the same convention to staging and production. Consistency reduces cognitive load and makes it easier to reason about what's happening in each stage.

Fifth, be mindful of sensitive information. While stage variables are visible in the AWS Console and pipeline logs, they're not encrypted at rest. Never store database passwords, API keys, or other sensitive credentials directly in stage variables. Instead, use AWS Secrets Manager or AWS Systems Manager Parameter Store and reference those from your deployment templates.

Sixth, test your variable substitution thoroughly. Before deploying to production, verify that all your stage variables are being interpolated correctly. You can see the resolved values in the pipeline execution details within the CodePipeline console, which is invaluable for debugging.

### Common Patterns and Advanced Scenarios

Beyond the basic multi-environment setup, stage variables enable several sophisticated deployment patterns.

One powerful pattern is conditional deployment. You might want to deploy to development and staging on every commit but only deploy to production when you explicitly trigger a release. Stage variables can represent this logic. Your pipeline might have all three stages present, but the production stage is configured to run only when triggered manually or by a specific event.

Another pattern involves A/B testing or canary deployments. You can use stage variables to control the percentage of traffic routed to new versions. A variable like `TrafficShiftPercentage` could be set to 5 for staging (routing only 5% of traffic to the new version) and 100 for production (full cutover after validation).

Progressive deployment across regions is another scenario where stage variables shine. You might have stage variables representing different AWS regions, allowing your single pipeline to deploy to us-east-1, then eu-west-1, then ap-southeast-1, with approvals between regions for compliance requirements.

Cost optimization also benefits from stage variables. You could use variables to control the size of infrastructure deployed to each environment. Development might use small instance types (`t3.micro`), staging might use medium instances (`t3.small`), and production might use larger instances (`c5.xlarge`). This ensures you're spending appropriately for each environment's needs.

### Accessing Stage Variables in Different Contexts

While we've covered CloudFormation and CodeBuild extensively, it's worth understanding how stage variables work in other contexts.

In Lambda functions used within CodePipeline, you can access stage variables through the CodePipeline job details. When CodePipeline invokes your Lambda, the event payload includes a job ID that you can use to retrieve full job details, including any stage variables that were defined.

In CodeDeploy actions, you can pass stage variables as environment variable overrides, similar to CodeBuild. Your deployment scripts can then read these environment variables and adapt their behavior accordingly.

In manual approval actions, stage variables are particularly useful for formatting approval messages. You might create an approval message that includes the environment name and target deployment details using stage variables, making it clear to approvers exactly what they're approving and why.

For API Gateway or other AWS services that you're configuring through CloudFormation, stage variables in your templates flow through naturally, allowing the entire infrastructure definition to be environment-aware.

### Troubleshooting Stage Variable Issues

When things don't work as expected, there are several reliable troubleshooting approaches.

First, examine the pipeline execution details in the CodePipeline console. When you view a specific execution, you can see the actual values that were resolved for each action. This shows you exactly what substitution occurred and often immediately reveals if a variable name was misspelled or a value was incorrect.

Second, check your CloudFormation stack events if you're using CloudFormation deployments. If parameter substitution failed, CloudFormation will report an error message that often pinpoints the problem.

Third, if you're using CodeBuild, look at the build logs. The environment variables section of the log shows which variables were set and their values. If a variable is missing, you'll see it clearly there.

Fourth, verify that your stage variable names match exactly in the substitution tokens. The syntax `#{VariableName}` is case-sensitive. `#{EnvironmentName}` is different from `#{environmentName}`.

Finally, remember that some characters have special meaning in JSON. If your stage variable value contains quotes or backslashes, ensure they're properly escaped in your pipeline configuration.

### Scaling Your Pipeline Infrastructure

As your organization grows and you manage more applications and environments, stage variables become increasingly valuable for scalability. A single pipeline definition with well-designed stage variables can serve multiple applications if you parameterize application-specific details like repository URLs and artifact locations.

You might create a "template" pipeline that uses generic stage variables, then clone this pipeline for each application, customizing only the stage variable values. This approach provides consistency while allowing per-application customization. It also simplifies compliance and security audits—you're checking a single pipeline template rather than dozens of unique configurations.

Organizations using multiple AWS accounts (a recommended security practice) can leverage stage variables to reference different artifact buckets, IAM roles, and deployment targets across accounts. Your pipeline logic remains constant while the account-specific details come from stage variables.

### Conclusion

Stage variables transform CodePipeline from a static, environment-specific orchestration tool into a dynamic, reusable framework for multi-environment deployments. By parameterizing your pipeline at the stage level and referencing these variables throughout your actions, you eliminate duplication, reduce maintenance burden, and create a more scalable infrastructure delivery system.

The key insight is that stage variables represent the conceptual separation between your pipeline's logic (which should be consistent) and its configuration (which varies by environment). By treating these separately, you achieve the best of both worlds: the consistency and reliability that comes from shared, well-tested logic, and the flexibility to adapt to different environments' unique requirements.

Whether you're managing a simple three-environment pipeline or a complex, multi-account, multi-region deployment system, stage variables provide the foundation for building sophisticated deployment automation that scales with your organization's needs. Start with basic parameterization of environment names and bucket locations, then gradually expand to more advanced patterns like progressive deployments and conditional logic. Your future self—and your team—will appreciate the maintainability and clarity that comes from a well-structured, variable-driven pipeline.
