---
title: "CloudFormation Wait Conditions and Creation Policies: Coordinating Resource Dependencies"
---

## CloudFormation Wait Conditions and Creation Policies: Coordinating Resource Dependencies

When you provision infrastructure on AWS, resources rarely exist in isolation. A web application needs its database to be running before the application server can connect to it. A load balancer must be fully initialized before traffic should route through it. An EC2 instance might need time to download and configure software before it can serve requests. CloudFormation's basic dependency model—the `DependsOn` attribute—tells CloudFormation to create resources in a specific order, but it doesn't actually verify that a resource is *ready* to use. That's where wait conditions and creation policies come in.

These advanced coordination mechanisms allow you to synchronize your infrastructure provisioning with real-world readiness checks. Instead of hoping that a resource is available by the time the next resource tries to use it, you can explicitly wait for confirmation that the resource has completed its initialization. This article explores how creation policies and wait conditions work, how they differ, when to use each one, and how to troubleshoot when things go wrong.

### Understanding the Problem: Why DependsOn Isn't Enough

Let's start with a concrete scenario. You're deploying an EC2 instance that needs to run a configuration script at startup. The script downloads packages, compiles code, and starts a web server. Meanwhile, your template also defines an Auto Scaling group that should only start launching instances after your primary instance is fully operational.

If you use only `DependsOn`, CloudFormation will ensure the EC2 instance is created before the Auto Scaling group is created. But CloudFormation marks the EC2 instance as `CREATE_COMPLETE` as soon as the instance transitions to the running state—long before your startup script finishes executing. The Auto Scaling group might then attempt to launch replicas before the primary instance is actually ready, leading to configuration mismatches or runtime errors.

This gap between "resource created" and "resource ready" is what creation policies and wait conditions address. They introduce an explicit handshake: CloudFormation waits to mark a resource as complete until it receives confirmation that the resource has genuinely finished its initialization.

### Creation Policies: Waiting for Resource Readiness

A creation policy is an attribute you apply directly to a resource in your CloudFormation template. It instructs CloudFormation to hold off marking the resource as `CREATE_COMPLETE` until one of two things happens: either it receives a success signal from the resource itself, or a timeout expires. Creation policies are particularly useful for EC2 instances and Auto Scaling groups.

#### How Creation Policies Work

When you attach a creation policy to a resource, CloudFormation enters a waiting state after creating that resource. During this wait, the resource can signal back to CloudFormation using the `cfn-signal` helper script or the `SignalResource` API call. Once CloudFormation receives the required number of successful signals, it marks the resource as complete and proceeds with the next resources in the template.

Here's a practical example. Imagine you have an EC2 instance running a script that initializes a database connection:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    CreationPolicy:
      ResourceSignal:
        Count: 1
        Timeout: PT15M
    Properties:
      ImageId: ami-0c55b159cbfafe1f0
      InstanceType: t3.micro
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          set -e
          # Run initialization script
          /opt/init/setup.sh
          # Signal success back to CloudFormation
          /opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} \
            --resource MyInstance --region ${AWS::Region}
```

The `CreationPolicy` block specifies two important parameters. The `Count` parameter tells CloudFormation how many successful signals it should expect before considering the resource ready. The `Timeout` parameter, expressed in ISO 8601 duration format (PT15M means 15 minutes), sets how long CloudFormation will wait. If the timeout expires before all signals arrive, CloudFormation rolls back the entire stack.

The `cfn-signal` helper script is a Python tool pre-installed on Amazon Linux 2 and other AWS-provided AMIs. It communicates with CloudFormation's API to confirm that the resource has finished its initialization. The `-e $?` flag captures the exit code of the previous command, so if the setup script fails, the signal reflects that failure.

#### Creation Policy Parameters Explained

The `Timeout` parameter deserves special attention because misconfiguring it is a common source of stack rollbacks. CloudFormation interprets the timeout as an absolute deadline from the moment it creates the resource. If your initialization script realistically takes 8 minutes but you set the timeout to 5 minutes, your stack will fail regardless of how well the script performs. A good practice is to observe how long initialization takes in your environment and then add a buffer—perhaps set it to 1.5 or 2 times the observed duration.

The `Count` parameter allows you to wait for multiple signals from the same resource. This is most useful with Auto Scaling groups, where you might want to wait for a certain number of instances to signal readiness before declaring the group complete. For a single EC2 instance, you'll typically set `Count: 1`.

#### Signaling Readiness: cfn-signal vs. SignalResource

CloudFormation provides two ways to send signals: the `cfn-signal` command-line helper and the `SignalResource` API call. For most scenarios involving EC2 instances, `cfn-signal` is simpler because it's designed specifically for this purpose and is available on EC2 instances. You call it from your UserData script after your initialization logic completes.

The `SignalResource` API offers more flexibility. You might use it when you're signaling from a Lambda function, a container, or any other AWS service that has programmatic access to the CloudFormation API. Here's what a Lambda-based signal might look like:

```python
import boto3
import json

cloudformation = boto3.client('cloudformation')

def lambda_handler(event, context):
    try:
        # Perform some initialization work
        setup_result = initialize_resources()
        
        # Signal success
        cloudformation.signal_resource(
            StackName='MyStackName',
            LogicalResourceId='MyResourceId',
            UniqueId=context.request_id,
            Status='SUCCESS'
        )
        return {'statusCode': 200, 'body': json.dumps('Signal sent')}
    except Exception as e:
        # Signal failure
        cloudformation.signal_resource(
            StackName='MyStackName',
            LogicalResourceId='MyResourceId',
            UniqueId=context.request_id,
            Status='FAILURE'
        )
        raise e
```

Notice that `SignalResource` requires a `UniqueId` parameter. This is a unique identifier for each signal, used to prevent duplicate counting. When using `cfn-signal`, this is typically the instance ID. When using the API directly, you might use a request ID, a timestamp, or any other unique value.

### Wait Conditions: Manual Synchronization Points

While creation policies are attached directly to resources, wait conditions are standalone logical resources in your template. They serve as explicit synchronization points—placeholders where CloudFormation pauses until something external signals that it's time to proceed.

Wait conditions are particularly valuable when you need to coordinate between resources that CloudFormation doesn't directly control, or when you want to introduce a manual approval step into your infrastructure provisioning. They're also useful for complex multi-stage deployments where you need fine-grained control over orchestration.

#### Anatomy of a Wait Condition

A wait condition consists of two parts: the `AWS::CloudFormation::WaitCondition` resource itself, and an `AWS::CloudFormation::WaitConditionHandle` that serves as a target for signals.

Here's a basic example:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyWaitConditionHandle:
    Type: AWS::CloudFormation::WaitConditionHandle
  
  MyWaitCondition:
    Type: AWS::CloudFormation::WaitCondition
    Properties:
      Handle: !Ref MyWaitConditionHandle
      Count: 1
      Timeout: 900
    DependsOn: SomeOtherResource
```

The handle is a simple, token-like resource that acts as a target for signals. The wait condition references this handle and specifies how many signals to expect and how long to wait. The `Timeout` parameter is specified in seconds, unlike the `PT15M` format used in creation policies.

Unlike creation policies, which are attributes of the resources they monitor, wait conditions are full CloudFormation resources with lifecycle management. This means they appear in your stack's outputs and can be referenced by other resources.

#### Signaling Wait Conditions from External Sources

The real power of wait conditions emerges when you need to signal readiness from outside your template. Imagine a deployment scenario where a human must manually verify that a load balancer is properly configured before the infrastructure is fully operational. You could use a wait condition to pause the stack until an operator explicitly signals success.

Signaling a wait condition is done through its handle. The handle has a physical ID that's actually a pre-signed URL. You can POST to this URL with a signal, and CloudFormation will record it as progress toward satisfying the wait condition.

Here's a CLI example of signaling a wait condition:

```bash
HANDLE_URL=$(aws cloudformation describe-stacks \
  --stack-name MyStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WaitConditionHandle`].OutputValue' \
  --output text)

curl -X PUT -H 'Content-Type:' --data-binary \
  '{"Status" : "SUCCESS" , "Reason" : "Configuration verified" , "UniqueId" : "ID1" , "Data" : "Setup complete"}' \
  "$HANDLE_URL"
```

This approach is particularly useful in CI/CD pipelines. Your deployment script could pause at a wait condition, allowing manual verification or integration tests to run, and then signal success or failure to proceed or rollback.

### Creation Policies vs. Wait Conditions: When to Use Each

The distinction between these two mechanisms can be subtle, but it matters for template clarity and operational patterns.

**Use creation policies** when you want CloudFormation to verify that a specific resource is ready before marking it as complete. This is the right choice for EC2 instances that need bootstrap scripts, Auto Scaling groups that need to verify instance readiness, or CloudFormation-aware resources that can signal their own completion. Creation policies are tightly bound to the resource they monitor, which makes templates more self-documenting.

**Use wait conditions** when you need synchronization points that exist independently of any single resource. They're valuable for coordinating between resources managed by different mechanisms, for introducing manual approval steps, or for waiting on external systems. They're also useful when you need to wait for something that CloudFormation itself doesn't manage—perhaps waiting for a third-party API to complete a configuration, or for a colleague to perform a manual task.

In practice, many production deployments use creation policies for infrastructure components and wait conditions for external integrations or approval workflows.

### Handling Timeouts and Troubleshooting Hung Stacks

One of the most frustrating experiences with wait conditions and creation policies is a stack that hangs indefinitely, waiting for signals that never arrive. When this happens, you either need to wait for the timeout to expire (which could be 15 minutes or more), or manually delete the stuck stack.

The most common cause is that the signal-sending mechanism failed silently. For EC2 instances using `cfn-signal`, this often happens because the UserData script exited with an error before reaching the signal call, or because the instance lacks the IAM permissions needed to call CloudFormation APIs.

To diagnose signal problems, first check the instance's UserData logs. On Amazon Linux instances, these are typically in `/var/log/cloud-init-output.log`. Look for any errors in your initialization script and verify that `cfn-signal` was actually executed.

Second, verify IAM permissions. The EC2 instance's IAM role needs permission to call `cloudformation:SignalResource`. Here's a minimal policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:SignalResource"
      ],
      "Resource": "*"
    }
  ]
}
```

Third, ensure that the instance has network connectivity. The `cfn-signal` command needs to reach CloudFormation's API endpoints, which are internet-facing. If your instance is in a private subnet, it needs a NAT gateway or NAT instance to reach the internet, or a VPC endpoint for CloudFormation.

For wait conditions, the problem is usually that the code responsible for signaling never executes. If you're using a Lambda function to signal, check CloudWatch Logs to see if the function ran at all and what errors it encountered. If you're using a manual signaling process (like the curl example above), verify that the person or script responsible for signaling actually sent the request.

A practical debugging technique is to temporarily reduce the timeout value during development so you don't have to wait long for failures to manifest. Once your signals are working reliably, increase the timeout to a production-appropriate value.

### Real-World Example: Coordinating a Complete Web Stack

Let's build a more comprehensive example that shows creation policies and wait conditions working together in a realistic scenario. We'll deploy an Auto Scaling group of web servers, a load balancer, and wait for both to be fully initialized before declaring success.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  KeyName:
    Type: AWS::EC2::KeyPair::KeyName
    Description: EC2 KeyPair for SSH access

Resources:
  # IAM role for EC2 instances
  InstanceRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ec2.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
      Policies:
        - PolicyName: CFNSignal
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: cloudformation:SignalResource
                Resource: '*'

  InstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles:
        - !Ref InstanceRole

  # Load balancer
  LoadBalancer:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Type: application
      Scheme: internet-facing
      Subnets:
        - subnet-12345678
        - subnet-87654321

  TargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Port: 80
      Protocol: HTTP
      VpcId: vpc-12345678
      TargetType: instance
      HealthCheckPath: /health
      HealthCheckIntervalSeconds: 30
      HealthCheckTimeoutSeconds: 5
      HealthyThresholdCount: 2
      UnhealthyThresholdCount: 3

  Listener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      DefaultActions:
        - Type: forward
          TargetGroupArn: !GetAtt TargetGroup.TargetGroupArn
      LoadBalancerArn: !GetAtt LoadBalancer.LoadBalancerArn
      Port: 80
      Protocol: HTTP

  # Wait condition for load balancer initialization
  LoadBalancerHandle:
    Type: AWS::CloudFormation::WaitConditionHandle

  LoadBalancerReady:
    Type: AWS::CloudFormation::WaitCondition
    Properties:
      Handle: !Ref LoadBalancerHandle
      Timeout: 300
      Count: 1
    DependsOn: Listener

  # Lambda to signal when load balancer is ready
  LBReadyChecker:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: python3.11
      Handler: index.handler
      Role: !GetAtt LambdaRole.Arn
      Code:
        ZipFile: |
          import boto3
          import json
          import urllib3
          
          cf = boto3.client('cloudformation')
          elb = boto3.client('elbv2')
          
          def handler(event, context):
              try:
                  # Get load balancer details
                  stack_name = event['StackName']
                  lb_arn = event['LoadBalancerArn']
                  
                  # Check that load balancer is in active state
                  response = elb.describe_load_balancers(
                      LoadBalancerArns=[lb_arn]
                  )
                  
                  state = response['LoadBalancers'][0]['State']['Code']
                  if state == 'active':
                      # Signal success
                      cf.signal_resource(
                          StackName=stack_name,
                          LogicalResourceId='LoadBalancerReady',
                          UniqueId='LB-Ready-1',
                          Status='SUCCESS'
                      )
                      return {'statusCode': 200, 'body': 'LB ready'}
              except Exception as e:
                  print(f"Error: {str(e)}")
                  raise

  LambdaRole:
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
      Policies:
        - PolicyName: CloudFormationAndELB
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - cloudformation:SignalResource
                  - elasticloadbalancing:DescribeLoadBalancers
                Resource: '*'

  # Launch template for instances
  LaunchTemplate:
    Type: AWS::EC2::LaunchTemplate
    Properties:
      LaunchTemplateData:
        ImageId: ami-0c55b159cbfafe1f0
        InstanceType: t3.micro
        IamInstanceProfile:
          Arn: !GetAtt InstanceProfile.Arn
        SecurityGroupIds:
          - sg-12345678
        UserData:
          Fn::Base64: !Sub |
            #!/bin/bash
            set -e
            
            # Install web server
            yum update -y
            yum install -y httpd
            
            # Create health check endpoint
            echo "OK" > /var/www/html/health
            echo "<h1>Server $(hostname -f)</h1>" > /var/www/html/index.html
            
            # Start service
            systemctl start httpd
            systemctl enable httpd
            
            # Signal readiness to CloudFormation
            /opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} \
              --resource WebServerGroup --region ${AWS::Region}

  # Auto Scaling group with creation policy
  WebServerGroup:
    Type: AWS::AutoScaling::AutoScalingGroup
    CreationPolicy:
      ResourceSignal:
        Count: 2
        Timeout: PT10M
    Properties:
      MinSize: 2
      MaxSize: 4
      DesiredCapacity: 2
      HealthCheckType: ELB
      HealthCheckGracePeriod: 300
      LaunchTemplate:
        LaunchTemplateId: !Ref LaunchTemplate
        Version: !GetAtt LaunchTemplate.LatestVersionNumber
      TargetGroupARNs:
        - !GetAtt TargetGroup.TargetGroupArn
      VPCZoneIdentifier:
        - subnet-12345678
        - subnet-87654321
    DependsOn: LoadBalancerReady

Outputs:
  LoadBalancerURL:
    Description: URL of the load balancer
    Value: !Sub 'http://${LoadBalancer.DNSName}'
  WaitConditionHandle:
    Description: Handle for manual load balancer readiness signal
    Value: !Ref LoadBalancerHandle
```

This template demonstrates several key patterns. The Auto Scaling group uses a creation policy to verify that at least two instances have successfully signaled readiness. The load balancer has a separate wait condition that holds the stack until a Lambda function confirms it's in an active state. The Auto Scaling group depends on the load balancer wait condition, ensuring the load balancer is ready before instances are created.

The flow is: load balancer is created → Lambda function checks and signals readiness → wait condition is satisfied → Auto Scaling group is created → instances bootstrap and signal readiness → Auto Scaling group creation policy is satisfied → stack is complete.

### Best Practices for Production Deployments

When using creation policies and wait conditions in production, follow these patterns to minimize operational problems.

First, always set timeouts conservatively. It's better to wait a bit longer than necessary than to fail prematurely. A 15-minute timeout for EC2 bootstrap is reasonable for most workloads. If instances frequently hit the timeout, investigate whether your initialization logic needs optimization or your timeout needs adjustment.

Second, ensure comprehensive logging. Use CloudWatch Logs to record what happens during resource initialization. This makes debugging failures much easier. For cfn-signal calls, consider logging the output and any errors before and after the signal call itself.

Third, test signal delivery in your deployment environment. Don't rely solely on local testing. Deploy a test stack with the same network configuration, IAM roles, and initialization logic you'll use in production. Verify that signals actually reach CloudFormation successfully.

Fourth, consider using stack policies to prevent accidental stack updates that could interfere with signaling. In production environments, you might want to prevent updates to creation policy or wait condition configurations.

Finally, monitor your stack creation process. CloudFormation provides events that you can log to CloudWatch, and you can set up alarms based on stack creation failures. This helps you catch problems early rather than waiting for a user to report that deployments are hanging.

### Conclusion

Creation policies and wait conditions are sophisticated coordination mechanisms that go far beyond CloudFormation's basic `DependsOn` attribute. Creation policies let you verify that resources like EC2 instances are truly ready before marking them as complete, preventing cascading failures from partially initialized infrastructure. Wait conditions provide explicit synchronization points for complex multi-stage deployments and external integrations.

The key insight is understanding when to use each mechanism: creation policies for verifying specific resources are ready, wait conditions for coordinating across independent components or introducing approval gates. Mastering these tools transforms CloudFormation from a simple resource provisioning service into a sophisticated orchestration platform capable of managing complex infrastructure workflows with confidence.

Start by implementing creation policies on your EC2 instances to ensure proper bootstrap verification. As your deployments grow more complex, introduce wait conditions to coordinate between systems. With proper error handling, logging, and timeout configuration, you'll build infrastructure that doesn't just exist, but that you can trust is actually ready to serve production traffic.
