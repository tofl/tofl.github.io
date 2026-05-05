---
title: "CloudFormation Transformation Examples: SAM and Other Transformation Processors"
---

## CloudFormation Transformation Examples: SAM and Other Transformation Processors

CloudFormation templates can sometimes feel verbose. A simple serverless application might require you to define API Gateway resources, Lambda functions, IAM roles, permissions, and integrations across dozens of lines of YAML or JSON. This is where CloudFormation transformations step in—they're processors that expand shorthand syntax into full CloudFormation resources before your stack is actually created. Think of them as macros or preprocessors that let you write less boilerplate while still leveraging CloudFormation's full power under the hood.

Understanding transformations is essential for anyone working with modern AWS infrastructure as code. Whether you're using the Serverless Application Model (SAM) to define Lambda applications, including external template files, or building custom transformation logic with Lambda functions, knowing how transformations work will deepen your appreciation for how higher-level tools build on CloudFormation's foundation.

### What Are CloudFormation Transformations?

A CloudFormation transformation is a processor that modifies your template before CloudFormation interprets it as native resources. You declare which transformations to apply using the `Transform` header at the top of your template. CloudFormation then passes your template to the transformation processor, which expands shorthand declarations into standard CloudFormation resources, and returns the expanded template for normal processing.

The magic here is abstraction without loss of control. You get a simpler, more readable template while CloudFormation still creates exactly the same AWS resources it would create if you'd written everything out manually. This is different from, say, a pre-processing script—transformations are a first-class CloudFormation feature, which means they're applied consistently, they're part of your template versioning, and they work seamlessly with stack updates.

### The Transform Header and How It Works

Every transformation starts with declaring it in your template's `Transform` header. Here's a minimal example using SAM:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: A simple serverless application

Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: python3.11
      CodeUri: s3://my-bucket/my-code.zip
```

When you submit this template to CloudFormation, here's what happens internally: CloudFormation recognizes the `AWS::Serverless-2016-10-31` transform, routes your template to the SAM transformation processor (which is hosted and managed by AWS), waits for it to return an expanded template, and then processes that expanded template as normal CloudFormation.

The key point is that you never see the expanded template by default—it happens transparently. However, if you want to see what SAM expands your shorthand into, you can use the AWS SAM CLI with the `build` or `validate` command, which shows you the transformed output. This visibility is incredibly helpful for learning and debugging.

### Serverless Application Model (SAM) in Depth

SAM is by far the most commonly used transformation. It's specifically designed to make serverless applications easier to define. Instead of manually wiring up Lambda functions, API Gateway resources, DynamoDB tables, and event sources, SAM provides shorthand resource types that expand into the full CloudFormation resources you'd write otherwise.

Let's look at a practical example. Consider a Lambda function that should respond to HTTP requests via API Gateway. Here's the SAM version:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  HelloWorldFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: hello_world/
      Handler: app.lambda_handler
      Runtime: python3.11
      Events:
        HelloWorldEvent:
          Type: Api
          Properties:
            Path: /hello
            Method: get
            RestApiId: !Ref ServerlessApi

  ServerlessApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: Prod
```

When SAM processes this template, it expands `AWS::Serverless::Function` and `AWS::Serverless::Api` into native CloudFormation resource types. The `AWS::Serverless::Function` becomes an `AWS::Lambda::Function`, but SAM also automatically creates the necessary IAM execution role, sets up permissions, and configures logging. The `AWS::Serverless::Api` becomes an `AWS::ApiGateway::RestApi`, and the event connection becomes an `AWS::Lambda::Permission` and an `AWS::ApiGateway::Method`.

Here's a simplified version of what that expanded template looks like after SAM processes it:

```yaml
AWSTemplateFormatVersion: '2010-09-09'

Resources:
  ServerlessApi:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: ServerlessApi

  ServerlessApiProdStage:
    Type: AWS::ApiGateway::Stage
    Properties:
      RestApiId: !Ref ServerlessApi
      StageName: Prod
      DeploymentId: !Ref ServerlessApiDeployment

  ServerlessApiDeployment:
    Type: AWS::ApiGateway::Deployment
    Properties:
      RestApiId: !Ref ServerlessApi

  HelloWorldFunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  HelloWorldFunction:
    Type: AWS::Lambda::Function
    Properties:
      Role: !GetAtt HelloWorldFunctionRole.Arn
      Handler: app.lambda_handler
      Runtime: python3.11
      Code:
        S3Bucket: my-bucket
        S3Key: my-code.zip

  HelloWorldFunctionApiPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref HelloWorldFunction
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ServerlessApi}/*/*

  HelloWorldEventResource:
    Type: AWS::ApiGateway::Resource
    Properties:
      RestApiId: !Ref ServerlessApi
      ParentId: !GetAtt ServerlessApi.RootResourceId
      PathPart: hello

  HelloWorldEventMethod:
    Type: AWS::ApiGateway::Method
    Properties:
      RestApiId: !Ref ServerlessApi
      ResourceId: !Ref HelloWorldEventResource
      HttpMethod: GET
      AuthorizationType: NONE
      Integration:
        Type: AWS_PROXY
        IntegrationHttpMethod: POST
        Uri: !Sub arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${HelloWorldFunction.Arn}/invocations
```

Notice how much more boilerplate the expanded version requires. The IAM role, the permissions, the API Gateway integration details—all of this was implicit in the SAM version. This is the real power of transformations: they let you express intent at a higher level while still producing standard CloudFormation resources that you can inspect, update, and manage like any other stack.

SAM supports many other resource types beyond functions and APIs, including `AWS::Serverless::SimpleTable` for DynamoDB tables, `AWS::Serverless::Application` for nested applications, and `AWS::Serverless::HttpApi` for HTTP APIs. Each one expands into multiple native resources with sensible defaults.

### AWS::Include for Template Modularity

Another built-in transformation worth knowing about is `AWS::Include`. It lets you break your CloudFormation template into multiple files and include them at deployment time. This is useful for keeping large templates organized or for sharing common resource definitions across templates.

Here's how it works. Suppose you have a separate file called `database.yaml` that defines your database resources:

```yaml
Resources:
  MyDatabase:
    Type: AWS::RDS::DBInstance
    Properties:
      Engine: mysql
      DBInstanceClass: db.t3.micro
      AllocatedStorage: 20
      MasterUsername: admin
      MasterUserPassword: !Sub '{{resolve:secretsmanager:${DBPasswordSecret}:SecretString:password}}'

  DBPasswordSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      GenerateSecretString:
        PasswordLength: 32
```

In your main template, you'd include it using the `AWS::Include` transform:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Include

Resources:
  MainApplicationRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ecs-tasks.amazonaws.com
            Action: sts:AssumeRole

  DatabaseStack:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: https://s3.amazonaws.com/my-bucket/database.yaml
```

Actually, let me correct that example. `AWS::Include` works slightly differently—it's used within the template to substitute external template snippets. The actual syntax uses the `Fn::Transform` function (or its short form) in your Resources or Outputs sections:

```yaml
AWSTemplateFormatVersion: '2010-09-09'

Resources:
  IncludedResources:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: https://s3.amazonaws.com/my-bucket/database.yaml
```

For true file inclusion and modularity, nested stacks (as shown above) are often more practical, though `AWS::Include` can be useful in specific scenarios where you want inline expansion rather than stack nesting.

### AWS::LanguageExtensions for Advanced Templating

CloudFormation introduced `AWS::LanguageExtensions` to support more powerful template features without creating entirely new resource types. This transformation enables functions like `Fn::ForEach` and `Fn::FindInMap` with more flexible syntax, and importantly, it allows `Fn::ToJsonString` for better string manipulation.

Here's a practical example. Suppose you want to create multiple Lambda functions using a loop:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::LanguageExtensions

Resources:
  FunctionExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole

  LambdaFunctions:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: !Sub |
        {
          "AWSTemplateFormatVersion": "2010-09-09",
          "Resources": {
            "Fn::ForEach": [
              "FunctionName",
              ["ProcessOrder", "SendNotification", "LogMetrics"],
              {
                "${FunctionName}": {
                  "Type": "AWS::Lambda::Function",
                  "Properties": {
                    "Role": "${FunctionExecutionRole.Arn}",
                    "Handler": "index.handler",
                    "Runtime": "python3.11",
                    "Code": {
                      "ZipFile": "def handler(event, context): return 'Hello'"
                    }
                  }
                }
              }
            ]
          }
        }
```

The `Fn::ForEach` function iterates over a list and creates resources for each item. Without `AWS::LanguageExtensions`, you'd have to manually duplicate the resource definition three times. This transformation makes templates more maintainable and DRY (Don't Repeat Yourself), especially for infrastructure that scales with similar patterns.

### Custom Transformations with Lambda

Beyond the built-in transformations, you can implement custom transformation logic using Lambda functions. This is powerful but also requires careful design because your Lambda function becomes a critical part of your infrastructure deployment pipeline.

To create a custom transformation, you write a Lambda function that accepts a CloudFormation template as input and returns an expanded template as output. The function receives an event containing the original template, processes it, and returns the transformed version.

Here's a simple example of a Lambda function that implements a custom transformation to standardize tags across all resources:

```python
import json

def lambda_handler(event, context):
    template = json.loads(event['fragment'])
    status = event['requestId']
    
    # Add standard tags to all resources
    standard_tags = {
        'Environment': 'Production',
        'ManagedBy': 'CloudFormation',
        'Team': 'Platform'
    }
    
    for resource_name, resource_config in template.get('Resources', {}).items():
        if 'Properties' not in resource_config:
            resource_config['Properties'] = {}
        
        if 'Tags' not in resource_config['Properties']:
            resource_config['Properties']['Tags'] = []
        
        current_tags = resource_config['Properties']['Tags']
        if isinstance(current_tags, dict):
            current_tags.update(standard_tags)
        else:
            for key, value in standard_tags.items():
                current_tags.append({'Key': key, 'Value': value})
    
    return {
        'requestId': status,
        'status': 'success',
        'fragment': json.dumps(template)
    }
```

To use this custom transformation, you'd deploy the Lambda function and then reference it in your CloudFormation template by its ARN:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: arn:aws:cloudformation:us-east-1:123456789012:transform/my-custom-transform

Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-application-bucket
```

CloudFormation will invoke your Lambda function with the template fragment, and your function must return the transformed fragment in the expected response format. The key fields in the response are `requestId` (to track the request), `status` (success or failure), and `fragment` (the transformed template as a JSON string).

Custom transformations shine in scenarios like enforcing organizational standards, implementing domain-specific languages, or adding dynamic behavior that goes beyond what SAM or other built-in transformations provide. However, they add complexity and introduce a dependency on your Lambda function being available during stack creation and updates. Always ensure your transformation Lambda has proper logging and error handling.

### Chaining Multiple Transformations

You can apply multiple transformations to a single template by specifying multiple `Transform` values. However, this requires care—transformations are applied in order, and each processor receives the output of the previous one. Here's an example:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform:
  - AWS::LanguageExtensions
  - AWS::Serverless-2016-10-31

Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: python3.11
      CodeUri: s3://my-bucket/code.zip
      Events:
        ApiEvent:
          Type: Api
          Properties:
            Path: /api
            Method: post
```

In this case, `AWS::LanguageExtensions` is applied first, which might expand any advanced templating features, and then the output is passed to the SAM transformer. When chaining transformations, understand the order and what each one expects as input and produces as output.

### Practical Considerations and Best Practices

When working with transformations, keep a few important points in mind. First, transformations add a layer of indirection to your template processing. While this indirection buys you convenience and reduced boilerplate, it also means you need to understand what your transformations are doing. Always validate your expanded templates, especially when using custom transformations or unfamiliar ones.

Second, be aware that some transformations have limitations. SAM, for instance, doesn't support every CloudFormation feature—some advanced configurations might require you to write raw CloudFormation resources alongside SAM shorthand. This is perfectly fine and actually quite common in real applications.

Third, test your templates in a non-production environment before deploying to production. Transformations can introduce subtle behavior differences, and catching these in development is far better than discovering them in a live system.

Fourth, document which transformations your templates use and why. A developer picking up your infrastructure code should immediately see in the `Transform` header what processing is happening. If you're using custom transformations, include comments explaining their purpose.

Finally, be cautious with custom transformations in production. They're powerful, but they introduce dependencies on Lambda functions that must be available during deployments. If your transformation function is broken or unavailable, your stack operations will fail. Always build in resilience through proper error handling and monitoring.

### Seeing What Transformations Produce

When you're learning transformations or debugging unexpected behavior, seeing the expanded template is invaluable. If you're using SAM, the AWS SAM CLI provides a `validate` command that shows you the expanded template:

```bash
sam validate --template template.yaml
```

For other transformations or for more detailed inspection, you can use the AWS CloudFormation console or CLI to get a sense of what's being created. With the CLI, you can describe stack resources after creation to see the actual AWS resources that were produced.

Another approach is to use the CloudFormation API directly. The `ValidateTemplate` API call will process your template, apply transformations, and validate it without creating a stack. You can then examine the output to understand the transformation.

### Conclusion

CloudFormation transformations are a fundamental feature that makes infrastructure as code more practical and maintainable. SAM brings serverless applications within reach without requiring you to be an expert in every API Gateway and Lambda permission detail. Built-in transformations like `AWS::Include` and `AWS::LanguageExtensions` extend CloudFormation's capabilities in specific directions. Custom transformations let you enforce organizational standards or implement domain-specific patterns.

Understanding how transformations work—that they're preprocessors that expand shorthand into standard CloudFormation resources—helps you write better templates and debug more effectively. Whether you're using SAM for serverless applications or implementing custom transformations for your organization, you're building on a powerful abstraction mechanism that CloudFormation provides.

The next time you write a CloudFormation template with a `Transform` header, take a moment to think about what that transformation is doing behind the scenes. You'll appreciate the complexity it's hiding for you, and you'll be in a much better position to extend CloudFormation's capabilities in ways that make your infrastructure more readable, maintainable, and aligned with your organization's standards.
