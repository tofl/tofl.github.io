---
title: "SAM Intrinsic Functions and Custom Resource Handling in Templates"
---

## SAM Intrinsic Functions and Custom Resource Handling in Templates

Building serverless applications with the AWS Serverless Application Model (SAM) often requires more than just defining Lambda functions and API gateways. When you need to wire resources together, reference values across stacks, or extend SAM's capabilities with custom logic, you're really working with the underlying CloudFormation engine. Understanding how to leverage CloudFormation intrinsic functions and custom resources within SAM templates is what separates developers who build simple applications from those architecting truly scalable, maintainable serverless systems.

In this article, we'll explore the practical patterns you need to master: how to use intrinsic functions like Fn::Sub, Fn::ImportValue, and Fn::GetAtt to create flexible, reusable templates, and how to extend SAM with custom resources when built-in constructs aren't quite enough. By the end, you'll know not just the syntax, but when and why to reach for each tool.

### Understanding SAM's Relationship with CloudFormation

Before diving into intrinsic functions and custom resources, it's worth understanding what SAM actually is. SAM is syntactic sugar on top of CloudFormation. When you deploy a SAM template, the SAM CLI transforms it into a standard CloudFormation template before submission to AWS. This transformation is crucial: it means everything you can do in CloudFormation, you can do in SAM templates. But it also means that understanding how SAM transforms your template helps you predict what will actually be deployed.

Consider a simple SAM template that defines a Lambda function and an API Gateway. That concise YAML you write gets expanded into a verbose CloudFormation template with all the necessary IAM roles, permissions, and resource configurations. The intrinsic functions and custom resources we're about to discuss work at this CloudFormation level, so SAM passes them through unchanged or slightly enhanced.

### The Power of Fn::Sub for Template Parameterization

Let's start with one of the most practical intrinsic functions: Fn::Sub. This function substitutes variables in a string, allowing you to dynamically construct values. In SAM templates, you'll use it constantly to build ARNs, bucket names, and resource references that depend on parameter values or other stack outputs.

The basic syntax of Fn::Sub has two forms. The simple form lets you reference parameters and pseudo-parameters directly in the string using ${Variable} syntax:

```yaml
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: python3.11
      CodeUri: s3://${BucketName}/code.zip
      Environment:
        Variables:
          TABLE_NAME: !Sub 'table-${AWS::StackName}-${Environment}'
```

In this example, AWS::StackName is a pseudo-parameter provided by CloudFormation that contains your stack's name, and Environment is a parameter you've defined elsewhere in your template. The resulting TABLE_NAME environment variable might be "table-my-api-dev" if your stack is named "my-api" and Environment is "dev".

The more powerful form of Fn::Sub accepts a map of variable substitutions, which is useful when you need to reference attributes or construct more complex values. Imagine you're creating a DynamoDB table and want to pass its stream ARN to a Lambda function:

```yaml
Parameters:
  Environment:
    Type: String
    Default: dev

Resources:
  EventTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub 'events-${Environment}'
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES

  ProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: processor.handler
      Runtime: python3.11
      CodeUri: src/
      Policies:
        - DynamoDBStreamReadPolicy:
            TableName: !Ref EventTable
            StreamSpecification: NEW_AND_OLD_IMAGES
      Environment:
        Variables:
          STREAM_ARN: !Sub
            - 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TableName}/stream/${StreamLabel}'
            - TableName: !Ref EventTable
              StreamLabel: !GetAtt EventTable.StreamSpecification.LatestStreamLabel
```

Wait—that last part won't work as written because DynamoDB's StreamSpecification doesn't expose LatestStreamLabel through GetAtt in that way. But this illustrates the pattern. In reality, you'd get the stream ARN like this:

```yaml
  ProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: processor.handler
      Runtime: python3.11
      CodeUri: src/
      Policies:
        - DynamoDBStreamReadPolicy:
            TableName: !Ref EventTable
      Environment:
        Variables:
          STREAM_ARN: !GetAtt EventTable.StreamArn
```

The key insight here is that Fn::Sub gives you a way to construct resource identifiers and configuration values dynamically, which becomes essential as your infrastructure grows beyond a single stack or when you need to parameterize names based on environment.

### Cross-Stack References with Fn::ImportValue

One of the most powerful patterns in serverless architecture is decomposing infrastructure into multiple stacks. You might have one stack for networking, another for shared databases, and separate stacks for different microservices. When stack B needs to reference a resource created in stack A, you use CloudFormation exports and the Fn::ImportValue function.

Here's how it works in practice. In your shared infrastructure stack, you create an export:

```yaml
Resources:
  SharedDatabase:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: shared-data
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: id
          AttributeType: S
      KeySchema:
        - AttributeName: id
          KeyType: HASH

Outputs:
  DatabaseTableName:
    Value: !Ref SharedDatabase
    Export:
      Name: !Sub '${AWS::StackName}-table-name'
  DatabaseTableArn:
    Value: !GetAtt SharedDatabase.Arn
    Export:
      Name: !Sub '${AWS::StackName}-table-arn'
```

Notice the Export section. By naming the export based on the stack name, you avoid collisions if you deploy the same infrastructure in different environments or accounts. The export name becomes a globally available reference within your AWS region.

Now, in a different SAM template for your application function, you import and use these values:

```yaml
Resources:
  DataProcessor:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.handler
      Runtime: python3.11
      CodeUri: src/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !ImportValue 'shared-infrastructure-table-name'
      Environment:
        Variables:
          TABLE_NAME: !ImportValue 'shared-infrastructure-table-name'
          TABLE_ARN: !ImportValue 'shared-infrastructure-table-arn'
```

The beauty of this approach is loose coupling. Your microservice function doesn't need to know where the shared database comes from; it just imports the value by name. If you later decide to refactor your infrastructure, you can update the export without touching the dependent stack's template (though you still need to update the import statements).

A practical consideration: when you delete stacks that have exports, you must first delete all stacks that import them. This dependency chain is worth planning for. In development environments, you might use a simpler approach where values are passed as parameters to avoid managing exports, but as infrastructure grows, imports become indispensable.

### Referencing Resource Attributes with Fn::GetAtt

While Fn::Sub helps you construct values and Fn::ImportValue pulls in values from other stacks, Fn::GetAtt retrieves attributes from resources within your own stack. Every AWS resource exposes different attributes, and learning which ones are available for resources you frequently use is a worthwhile investment.

For example, when you create an S3 bucket, you get its domain name. When you create an SQS queue, you get its ARN and URL. SAM and CloudFormation resources document their return values, and GetAtt accesses them.

Consider a practical scenario where you're building a file processing application. You create an S3 bucket for input files, and you want Lambda functions to access it by its domain name for cross-origin requests:

```yaml
Resources:
  InputBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'input-files-${AWS::AccountId}-${Environment}'
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

  ProcessingFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: processor.handler
      Runtime: python3.11
      CodeUri: src/
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref InputBucket
      Environment:
        Variables:
          BUCKET_NAME: !Ref InputBucket
          BUCKET_ARN: !GetAtt InputBucket.Arn
          BUCKET_DOMAIN: !GetAtt InputBucket.DomainName

  NotificationQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub 'processing-queue-${Environment}'

  NotifyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: notifier.handler
      Runtime: python3.11
      CodeUri: src/
      Environment:
        Variables:
          QUEUE_URL: !Ref NotificationQueue
          QUEUE_ARN: !GetAtt NotificationQueue.Arn
```

In this template, we're using both !Ref (which returns the bucket name for S3 and the queue URL for SQS) and !GetAtt to access specific attributes. The key difference: !Ref typically returns the primary identifier, while !GetAtt gives you access to secondary properties.

One pattern worth mentioning is chaining GetAtt calls. If you have a Lambda function that triggers from a DynamoDB stream, you might need the stream ARN:

```yaml
  StreamProcessor:
    Type: AWS::Serverless::Function
    Properties:
      Handler: stream.handler
      Runtime: python3.11
      CodeUri: src/
      Events:
        DynamoDBStream:
          Type: DynamoDB
          Properties:
            Stream: !GetAtt DataTable.StreamArn
            StartingPosition: TRIM_HORIZON
            BatchSize: 100
```

Here, GetAtt is retrieving the StreamArn attribute directly from the DynamoDB table resource. SAM passes this through to CloudFormation, which resolves it at deployment time.

### Extending SAM with Custom Resources

Sometimes AWS provides a managed service for what you need, but sometimes you need custom logic that fits outside the standard resource types. Custom resources let you invoke Lambda functions (or SNS topics) during stack creation, update, or deletion, allowing you to implement arbitrary provisioning logic.

A classic scenario is provisioning a third-party service or configuring an external system as part of your stack. Maybe you need to create a user in an external API, configure a webhook, or initialize data in a non-AWS system. That's where CloudFormation custom resources shine.

In SAM, you define a custom resource like this:

```yaml
Resources:
  InitializationRole:
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

  InitializerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: initializer.handler
      Runtime: python3.11
      CodeUri: src/
      Role: !GetAtt InitializationRole.Arn

  MyCustomResource:
    Type: AWS::CloudFormation::CustomResource
    Properties:
      ServiceToken: !GetAtt InitializerFunction.Arn
      Environment: !Ref Environment
      ConfigValue: some-config-data
```

The ServiceToken property points to the Lambda function (or SNS topic) that CloudFormation will invoke. Any additional properties you define (like Environment and ConfigValue above) get passed to the Lambda function as part of the event.

Now, your Lambda function needs to handle these custom resource events. Here's what the handler looks like:

```python
import json
import boto3
import cfnresponse

def handler(event, context):
    try:
        print(f"Received event: {json.dumps(event)}")
        
        request_type = event['RequestType']
        properties = event['ResourceProperties']
        physical_resource_id = event.get('PhysicalResourceId', 'custom-resource-1')
        
        if request_type == 'Create':
            # Your initialization logic here
            environment = properties.get('Environment')
            config_value = properties.get('ConfigValue')
            
            # Example: call an external API, provision resources, etc.
            result = initialize_external_system(environment, config_value)
            physical_resource_id = result['resource_id']
            
            response_data = {
                'Message': 'Resource created successfully',
                'ResourceId': physical_resource_id
            }
            cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
            
        elif request_type == 'Update':
            # Handle updates
            response_data = {'Message': 'Resource updated'}
            cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
            
        elif request_type == 'Delete':
            # Clean up resources
            cleanup_external_system(physical_resource_id)
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physical_resource_id)
            
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, event.get('PhysicalResourceId', 'custom-resource-1'))

def initialize_external_system(environment, config_value):
    # Your custom logic here
    return {
        'resource_id': f'custom-{environment}-resource'
    }

def cleanup_external_system(resource_id):
    # Cleanup logic
    pass
```

The critical piece here is the cfnresponse module. CloudFormation needs to know whether your custom resource succeeded or failed, and the cfnresponse.send() call communicates that back. If you don't send a response, CloudFormation will timeout (after about an hour for creates, 15 minutes for updates and deletes), which isn't what you want.

The PhysicalResourceId is important—it's how CloudFormation tracks your custom resource across updates. If you return a different physical ID in an update compared to the create, CloudFormation will treat it as a replacement (delete the old one, create a new one). If you return the same ID, it's considered an update of the existing resource.

### Practical Example: Building a Multi-Environment Application

Let's tie these concepts together with a realistic scenario. You're building a serverless API that needs to work across multiple environments (dev, staging, production), share a common database, and integrate with an external service that requires initialization.

Your shared infrastructure stack exports the database table name:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Parameters:
  Environment:
    Type: String

Resources:
  SharedTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub 'shared-data-${Environment}'
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH

Outputs:
  TableName:
    Value: !Ref SharedTable
    Export:
      Name: !Sub 'SharedTable-${Environment}'
  TableArn:
    Value: !GetAtt SharedTable.Arn
    Export:
      Name: !Sub 'SharedTableArn-${Environment}'
```

Your application stack imports these values, uses Fn::Sub to construct environment-specific names, and includes a custom resource for third-party initialization:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Parameters:
  Environment:
    Type: String
    Default: dev
  ExternalServiceKey:
    Type: String
    NoEcho: true

Resources:
  InitializationRole:
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

  ServiceInitializer:
    Type: AWS::Serverless::Function
    Properties:
      Handler: initializer.handler
      Runtime: python3.11
      CodeUri: src/initializer/
      Role: !GetAtt InitializationRole.Arn
      Timeout: 60

  ExternalServiceSetup:
    Type: AWS::CloudFormation::CustomResource
    Properties:
      ServiceToken: !GetAtt ServiceInitializer.Arn
      Environment: !Ref Environment
      ServiceKey: !Ref ExternalServiceKey

  ApiFunction:
    Type: AWS::Serverless::Function
    DependsOn: ExternalServiceSetup
    Properties:
      Handler: api.handler
      Runtime: python3.11
      CodeUri: src/api/
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !ImportValue !Sub 'SharedTable-${Environment}'
      Environment:
        Variables:
          TABLE_NAME: !ImportValue !Sub 'SharedTable-${Environment}'
          TABLE_ARN: !ImportValue !Sub 'SharedTableArn-${Environment}'
          SERVICE_ENDPOINT: !Sub 'https://api-${Environment}.example.com'
          STACK_NAME: !Ref AWS::StackName
      Events:
        ApiEvent:
          Type: Api
          Properties:
            Path: /items
            Method: GET
            RestApiId: !Ref ApiGateway

  ApiGateway:
    Type: AWS::Serverless::Api
    Properties:
      StageName: !Ref Environment
      TracingEnabled: true
      MethodSettings:
        - ResourcePath: '/*'
          HttpMethod: '*'
          LoggingLevel: INFO
          DataTraceEnabled: true
          MetricsEnabled: true
```

In this template, we're using ImportValue to pull the table name from the shared infrastructure stack, using Fn::Sub to construct environment-specific values like the service endpoint, and including a custom resource that must complete before the API function can be used (via the DependsOn attribute). When you deploy this with environment=prod, all the variable substitutions resolve correctly, and the external service gets initialized.

### SAM Transformation and What Really Gets Deployed

It's worth understanding what happens when you run `sam deploy`. The SAM CLI reads your template, transforms it into a standard CloudFormation template, uploads artifacts to S3, and submits the template to CloudFormation. The intrinsic functions and custom resources don't get evaluated by SAM—they pass through unchanged. CloudFormation evaluates them at deployment time.

You can actually see this transformation by running `sam build` and examining the generated template in the .aws-sam directory, or by using `sam validate --debug`. This is helpful when you're troubleshooting issues—sometimes your intrinsic function syntax is off, and seeing the actual CloudFormation error message clarifies the problem.

One nuance: SAM does special handling for certain constructs. For example, when you use a SAM Globals section to define common properties, SAM applies those before transformation. Similarly, SAM's policy templates (like DynamoDBCrudPolicy) get transformed into explicit IAM policy documents. But all of this happens before the CloudFormation evaluation, so your intrinsic functions work as expected on the transformed resources.

### Common Pitfalls and Best Practices

When working with intrinsic functions and custom resources in SAM templates, a few pitfalls deserve mention. First, circular dependencies. If stack A exports a value that stack B imports, and then stack B exports something that stack A tries to import, your deployment fails. Design your stack boundaries carefully to maintain a clean dependency graph.

Second, the physical resource ID in custom resources. If you're not careful about how you generate this ID, you might accidentally trigger replacements when you intended updates, or worse, lose track of resources you've provisioned. Always document your ID scheme and be consistent.

Third, timeout handling with custom resources. Your Lambda function should complete within the CloudFormation timeout window. For creates, you have about an hour, but for updates and deletes, it's 15 minutes. If your logic takes longer, break it into asynchronous steps with callbacks, or design for eventual consistency.

For best practices, consider these principles: keep your Fn::Sub expressions readable by breaking complex strings across multiple lines. Use meaningful names for exports to avoid collisions. Document which values your templates export and import. Test custom resources thoroughly before deploying to production—custom resources that fail during stack updates can leave your infrastructure in an inconsistent state. Consider using configuration management or parameter store for values that might change frequently, rather than exporting them from stacks.

### Conclusion

Mastering SAM intrinsic functions and custom resources transforms you from someone who can build simple serverless applications to someone who can architect complex, modular infrastructure. Fn::Sub lets you parameterize your templates for flexibility, Fn::ImportValue enables loose coupling across stacks, and Fn::GetAtt helps you wire resources together. Custom resources extend SAM's capabilities to handle scenarios where built-in constructs fall short.

The patterns we've covered—cross-stack references, dynamic value construction, and custom provisioning—form the foundation of production serverless architecture. As you build more sophisticated applications, you'll find yourself reaching for these tools constantly. The investment in understanding how they work, their limitations, and their best practices pays dividends in templates that are maintainable, reusable, and robust.
