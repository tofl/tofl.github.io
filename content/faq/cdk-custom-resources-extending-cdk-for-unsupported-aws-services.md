---
title: "CDK Custom Resources: Extending CDK for Unsupported AWS Services"
---

## CDK Custom Resources: Extending CDK for Unsupported AWS Services

The AWS Cloud Development Kit has come a long way in covering the AWS service landscape. Yet even with hundreds of constructs available, you'll eventually encounter a scenario where the exact resource or API operation you need isn't exposed through a construct. Maybe you need to call a newer AWS API that hasn't made it into the CDK yet, or perhaps you need to invoke a third-party service as part of your infrastructure deployment. This is where custom resources become your lifeline.

Custom resources in CDK give you the power to break out of construct boundaries and execute arbitrary logic during stack creation, updates, and deletion. In this article, we'll explore how to harness this capability effectively, from simple API calls to complex multi-step workflows.

### Understanding Why Custom Resources Matter

Imagine you're deploying a microservice architecture and need to register your API endpoints with an external service discovery system during stack deployment. Or perhaps you need to invoke a specialized operation in a newer AWS service that the CDK version you're using doesn't support yet. Without custom resources, you'd be stuck writing post-deployment scripts or managing resources manually—a process that's error-prone and difficult to replicate across environments.

Custom resources solve this problem by allowing you to embed arbitrary execution logic directly into your Infrastructure as Code. When your CDK stack deploys, the custom resource triggers your code, captures the response, and makes those outputs available to other resources in your stack. This keeps your infrastructure definition complete and reproducible.

### The Two Flavors of Custom Resources

CDK provides two primary paths for implementing custom resources: the `AwsCustomResource` class for straightforward AWS API calls, and Lambda-backed custom resources for more complex scenarios. The choice between them depends on the complexity of the logic you need to execute and whether you're calling AWS APIs or external services.

### Simple AWS API Calls with AwsCustomResource

When you need to invoke an AWS API operation that doesn't have a corresponding CDK construct, `AwsCustomResource` is your go-to solution. It's lightweight, requires minimal setup, and handles the boilerplate of CloudFormation custom resource plumbing for you.

Here's a practical example. Suppose you need to fetch the latest version of an AMI from your account during stack deployment, but the CDK construct for looking up AMIs doesn't support your specific filtering criteria. You could use `AwsCustomResource` to call the EC2 `DescribeImages` API directly:

```typescript
import * as cdk from 'aws-cdk-lib';
import { AwsCustomResource, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const amiLookup = new AwsCustomResource(this, 'AmiLookup', {
      onCreate: {
        service: 'ec2',
        action: 'describeImages',
        parameters: {
          Owners: ['self'],
          Filters: [
            {
              Name: 'tag:Environment',
              Values: ['production'],
            },
          ],
        },
        physicalResourceId: PhysicalResourceId.fromResponse('Images.0.ImageId'),
      },
      policy: cdk.aws_iam.PolicyStatement.fromJson({
        Effect: 'Allow',
        Action: 'ec2:DescribeImages',
        Resource: '*',
      }),
    });

    // Use the AMI ID in other resources
    const amiId = amiLookup.getResponseField('Images.0.ImageId');
    
    new cdk.aws_ec2.Instance(this, 'MyInstance', {
      vpc: /* your VPC */,
      instanceType: cdk.aws_ec2.InstanceType.of(
        cdk.aws_ec2.InstanceClass.T3,
        cdk.aws_ec2.InstanceSize.MICRO
      ),
      machineImage: cdk.aws_ec2.MachineImage.genericLinux({
        'us-east-1': amiId,
      }),
    });
  }
}
```

The `AwsCustomResource` class wraps the AWS SDK call and manages the CloudFormation integration for you. Notice the `physicalResourceId` parameter—this is crucial. The physical resource ID uniquely identifies your custom resource instance within CloudFormation. If the ID changes between updates, CloudFormation treats it as a new resource and deletes the old one. By setting it to `ImageId`, we ensure that if the same AMI ID is returned, CloudFormation recognizes it as the same resource.

You can also specify `onUpdate` and `onDelete` handlers if you need different behavior during those lifecycle events. For instance, if your API call has side effects that need to be cleaned up, you'd define an `onDelete` handler:

```typescript
const customResource = new AwsCustomResource(this, 'ApiCall', {
  onCreate: { /* ... */ },
  onUpdate: { /* ... */ },
  onDelete: {
    service: 'myservice',
    action: 'deleteResource',
    parameters: {
      ResourceId: customResource.getResponseField('ResourceId'),
    },
  },
  policy: cdk.aws_iam.PolicyStatement.fromJson({
    Effect: 'Allow',
    Action: [
      'myservice:CreateResource',
      'myservice:DescribeResource',
      'myservice:DeleteResource',
    ],
    Resource: '*',
  }),
});
```

### When You Need More Power: Lambda-Backed Custom Resources

While `AwsCustomResource` handles many scenarios elegantly, you'll occasionally need more sophisticated logic. Perhaps you need to make multiple sequential API calls, process and transform data, call third-party services, or implement complex error handling. That's where Lambda-backed custom resources enter the picture.

A Lambda-backed custom resource connects your custom resource directly to a Lambda function. When CloudFormation needs to create, update, or delete your custom resource, it invokes your Lambda function with event details. Your function executes your custom logic, then responds with success or failure. This gives you the full power of Python, Node.js, or any other Lambda runtime.

Here's what a Lambda function handler looks like for a custom resource:

```python
import json
import urllib3
import cfnresponse

http = urllib3.PoolManager()

def lambda_handler(event, context):
    print(f"Event: {json.dumps(event)}")
    
    try:
        request_type = event['RequestType']
        resource_properties = event['ResourceProperties']
        request_id = event['RequestId']
        stack_id = event['StackId']
        logical_resource_id = event['LogicalResourceId']
        
        # Your custom logic here
        if request_type == 'Create':
            response_data = handle_create(resource_properties)
        elif request_type == 'Update':
            response_data = handle_update(event['PhysicalResourceId'], resource_properties)
        elif request_type == 'Delete':
            response_data = handle_delete(event['PhysicalResourceId'], resource_properties)
        
        # The physical resource ID must be returned for Create requests
        physical_resource_id = event.get('PhysicalResourceId', request_id)
        
        # Send success response
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
    
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, event.get('PhysicalResourceId', 'unknown'))

def handle_create(props):
    # Call third-party API or execute complex logic
    api_url = props.get('ApiUrl')
    api_key = props.get('ApiKey')
    
    response = http.request(
        'POST',
        api_url,
        body=json.dumps({'action': 'register'}),
        headers={'Authorization': f'Bearer {api_key}'},
        timeout=urllib3.Timeout(5.0)
    )
    
    if response.status != 200:
        raise Exception(f"API call failed with status {response.status}")
    
    result = json.loads(response.data.decode('utf-8'))
    
    return {
        'ResourceId': result['id'],
        'Endpoint': result['endpoint'],
    }

def handle_update(physical_resource_id, props):
    # Update logic if needed
    return {'ResourceId': physical_resource_id}

def handle_delete(physical_resource_id, props):
    # Cleanup logic
    return {}
```

Now, from your CDK code, you'd create a custom resource that invokes this Lambda function:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { CustomResource, Duration } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the Lambda function
    const handler = new lambda.Function(this, 'CustomResourceHandler', {
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      handler: 'index.lambda_handler',
      timeout: Duration.seconds(60),
    });

    // Create a Provider to manage the custom resource lifecycle
    const provider = new Provider(this, 'CustomResourceProvider', {
      onEventHandler: handler,
    });

    // Create the actual custom resource
    const customResource = new CustomResource(this, 'MyCustomResource', {
      serviceToken: provider.serviceToken,
      properties: {
        ApiUrl: 'https://api.example.com/register',
        ApiKey: cdk.SecretValue.secretsManager('api-key').toString(),
      },
    });

    // Reference outputs from the custom resource
    const resourceId = customResource.getAttString('ResourceId');
    const endpoint = customResource.getAttString('Endpoint');

    new cdk.CfnOutput(this, 'ResourceEndpoint', {
      value: endpoint,
    });
  }
}
```

The `Provider` class is a helper that manages the infrastructure around your Lambda function. It creates the necessary IAM roles, handles the CloudFormation integration, and manages retries if your Lambda function fails. The `serviceToken` is what links your custom resource to the Lambda function.

### Understanding Physical Resource IDs

The physical resource ID is a concept that trips up many developers when first working with custom resources. In CloudFormation, each resource needs a unique identifier. For AWS resources like S3 buckets or EC2 instances, CloudFormation assigns this automatically. For custom resources, you must provide it.

The physical resource ID serves as the primary key for your custom resource. When you perform a stack update, CloudFormation compares the new physical resource ID with the old one. If they match, it's treated as an update to the same resource. If they differ, CloudFormation deletes the old resource and creates a new one. This distinction matters enormously when your custom resource has side effects.

For example, if your custom resource registers a service endpoint and you don't stabilize the physical resource ID, an update might cause the old endpoint to be deleted and a new one created—breaking any clients that cached the old endpoint.

In `AwsCustomResource`, you stabilize the ID using `PhysicalResourceId`:

```typescript
physicalResourceId: PhysicalResourceId.fromResponse('ResourceId'),
```

In Lambda-backed custom resources, you return it explicitly from your Lambda function:

```python
cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_resource_id)
```

The best practice is to set the physical resource ID to something immutable and meaningful—typically an identifier returned from the API call or operation you're performing.

### Practical Example: Registering with an External Service

Let's walk through a complete, realistic example. Imagine you're deploying a machine learning pipeline and need to register your model endpoint with a model registry service during stack deployment. The registry is a third-party service not yet supported by CDK.

Here's the Lambda function that performs the registration:

```python
import json
import boto3
import requests
import cfnresponse
import os

def lambda_handler(event, context):
    try:
        request_type = event['RequestType']
        props = event['ResourceProperties']
        
        model_name = props['ModelName']
        model_version = props['ModelVersion']
        endpoint_name = props['EndpointName']
        registry_url = props['RegistryUrl']
        registry_token = os.environ['REGISTRY_TOKEN']
        
        if request_type == 'Create':
            registry_response = register_model(
                registry_url,
                registry_token,
                model_name,
                model_version,
                endpoint_name
            )
            physical_id = registry_response['registration_id']
            response_data = {
                'RegistrationId': physical_id,
                'RegistryUrl': registry_response['registry_url'],
            }
        elif request_type == 'Update':
            # For updates, keep the same registration ID
            physical_id = event['PhysicalResourceId']
            update_model_metadata(
                registry_url,
                registry_token,
                physical_id,
                model_version
            )
            response_data = {
                'RegistrationId': physical_id,
            }
        elif request_type == 'Delete':
            # Cleanup: deregister the model
            physical_id = event['PhysicalResourceId']
            deregister_model(registry_url, registry_token, physical_id)
            response_data = {}
        
        cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_id)
    
    except Exception as e:
        print(f"Error: {str(e)}")
        physical_id = event.get('PhysicalResourceId', 'failed-resource')
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physical_id)

def register_model(url, token, name, version, endpoint):
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    }
    payload = {
        'model_name': name,
        'version': version,
        'endpoint': endpoint,
    }
    
    response = requests.post(f'{url}/register', json=payload, headers=headers, timeout=10)
    response.raise_for_status()
    return response.json()

def update_model_metadata(url, token, registration_id, version):
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    }
    payload = {'version': version}
    
    response = requests.patch(f'{url}/{registration_id}', json=payload, headers=headers, timeout=10)
    response.raise_for_status()

def deregister_model(url, token, registration_id):
    headers = {'Authorization': f'Bearer {token}'}
    response = requests.delete(f'{url}/{registration_id}', headers=headers, timeout=10)
    response.raise_for_status()
```

And the CDK code that invokes it:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { CustomResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';

interface ModelRegistrationProps extends cdk.StackProps {
  modelName: string;
  modelVersion: string;
  endpointName: string;
  registryUrl: string;
  registryTokenSecret: string;
}

export class ModelRegistrationStack extends cdk.Stack {
  public readonly registrationId: string;
  
  constructor(scope: cdk.App, id: string, props: ModelRegistrationProps) {
    super(scope, id, props);

    const handler = new lambda.Function(this, 'ModelRegistrationHandler', {
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      handler: 'register.lambda_handler',
      timeout: Duration.seconds(30),
      environment: {
        REGISTRY_TOKEN: cdk.SecretValue.secretsManager(props.registryTokenSecret).toString(),
      },
    });

    const provider = new Provider(this, 'ModelRegistrationProvider', {
      onEventHandler: handler,
      totalTimeout: Duration.minutes(5),
    });

    const registration = new CustomResource(this, 'ModelRegistration', {
      serviceToken: provider.serviceToken,
      properties: {
        ModelName: props.modelName,
        ModelVersion: props.modelVersion,
        EndpointName: props.endpointName,
        RegistryUrl: props.registryUrl,
      },
    });

    this.registrationId = registration.getAttString('RegistrationId');

    new cdk.CfnOutput(this, 'ModelRegistrationId', {
      value: this.registrationId,
      description: 'ID of the model in the external registry',
    });

    new cdk.CfnOutput(this, 'RegistryUrl', {
      value: registration.getAttString('RegistryUrl'),
      description: 'URL to view the registered model',
    });
  }
}
```

This example demonstrates several important practices: the Lambda function handles all three lifecycle events (Create, Update, Delete), preserves the physical resource ID across updates to prevent unnecessary resource recreation, stores sensitive credentials in AWS Secrets Manager and accesses them at runtime, and exposes meaningful outputs through the custom resource attributes that can be consumed by other parts of your stack.

### Error Handling and Timeouts

Custom resources can timeout or fail, and how you handle these scenarios matters for your stack's reliability. Lambda-backed custom resources have a default timeout of 1 hour managed by CloudFormation. If your Lambda function takes longer than that, the custom resource is marked as failed and your stack rollback may be triggered.

For operations that might be slow, make sure your Lambda function doesn't perform the actual work synchronously. Instead, consider kicking off an asynchronous job and polling for completion:

```python
def lambda_handler(event, context):
    request_type = event['RequestType']
    
    if request_type == 'Create':
        # Start an async job
        job_id = start_async_job(event['ResourceProperties'])
        
        # Poll for completion (with timeout)
        result = wait_for_job_completion(job_id, timeout=3500)
        
        physical_id = job_id
        response_data = {'JobId': job_id, 'Status': result['status']}
    
    cfnresponse.send(event, context, cfnresponse.SUCCESS, response_data, physical_id)
```

Also, always wrap your logic in a try-except block and ensure you call `cfnresponse.send()` with the `FAILED` status if something goes wrong. CloudFormation needs explicit feedback from your custom resource to know whether to proceed or rollback.

### Choosing Between AwsCustomResource and Lambda-Backed Custom Resources

The decision between these two approaches comes down to complexity and control. Use `AwsCustomResource` when you need to call AWS APIs that don't have CDK constructs and the operation is straightforward. It requires less boilerplate and is easier to understand at a glance.

Reach for Lambda-backed custom resources when you need to call external services, perform multiple operations, transform and validate responses, or implement sophisticated error handling. The extra complexity is justified when your requirements exceed simple API calls.

### Common Pitfalls and Best Practices

One frequent mistake is not setting meaningful physical resource IDs. Always choose an identifier that remains stable across updates and is meaningful for tracking resource identity in CloudFormation.

Another pitfall is forgetting to grant appropriate IAM permissions. Both `AwsCustomResource` and the Lambda function underlying Lambda-backed custom resources need permission to call the APIs or services they interact with. Audit your policies to ensure they're neither over-permissive nor missing necessary actions.

Be cautious with side effects and idempotency. If your custom resource creates external resources, ensure that running it multiple times with the same inputs produces the same result. This matters because stack updates might re-invoke your custom resource even if nothing actually changed from a CloudFormation perspective.

Finally, always test your custom resources locally before deploying them to production. For Lambda-backed custom resources, you can invoke your function locally with test events that mirror CloudFormation's structure. This catches bugs early and saves debugging time in production.

### Conclusion

Custom resources are a powerful escape hatch that transforms CDK from a tool bound by available constructs into a platform for expressing any infrastructure deployment logic you can imagine. Whether you're integrating with newer AWS APIs, talking to external services, or orchestrating complex provisioning workflows, custom resources give you the flexibility to build comprehensive Infrastructure as Code solutions.

Start with `AwsCustomResource` for simple AWS API calls—its simplicity will serve you well. Graduate to Lambda-backed custom resources when your needs grow beyond basic API invocations. In both cases, pay careful attention to physical resource IDs, error handling, and IAM permissions. With these practices in place, you'll have the foundation to extend CDK far beyond its built-in constructs and meet virtually any infrastructure deployment requirement your applications demand.
