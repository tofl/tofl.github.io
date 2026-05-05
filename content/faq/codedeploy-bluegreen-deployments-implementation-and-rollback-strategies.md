---
title: "CodeDeploy Blue/Green Deployments: Implementation and Rollback Strategies"
---

## CodeDeploy Blue/Green Deployments: Implementation and Rollback Strategies

Deploying new application versions without interrupting service is one of the most critical challenges in modern software delivery. Traditional deployment approaches — where you stop the old version, deploy the new one, and restart — inevitably create a window of downtime that frustrates users and erodes confidence in your system. AWS CodeDeploy's blue/green deployment strategy elegantly solves this problem by running two identical production environments simultaneously, shifting traffic between them with surgical precision, and automatically rolling back if things go wrong.

In this article, we'll explore how blue/green deployments work in CodeDeploy, how to implement them with ECS and Lambda, configure validation hooks that determine deployment success, and orchestrate rollbacks when alarms signal trouble. Whether you're building high-availability applications or preparing for the depths of AWS certification, understanding this capability will fundamentally improve how you think about safe, reliable releases.

### Why Blue/Green Deployments Matter

Before diving into the mechanics, let's establish why blue/green is worth the added complexity. In a traditional deployment, you have one production environment. You deploy changes directly to it, hoping everything works. If something breaks — and something always has a chance of breaking — your users are already affected. You're firefighting instead of preventing.

Blue/green flips this mental model on its head. Instead of one environment, you maintain two: the blue environment (currently serving production traffic) and the green environment (the newly deployed version, sitting idle and waiting). Once green is fully deployed and validated, you switch traffic from blue to green. If validation discovers a problem, you switch back to blue immediately. The blue environment never goes away — it's your instant rollback point.

This approach offers several advantages. First, it achieves near-zero downtime. Your users don't see a deployment happening; they experience a traffic shift that's typically imperceptible. Second, it decouples deployment from activation. You can deploy and thoroughly test without affecting production. Third, it gives you a known good state (blue) that you can instantly return to if green proves problematic. For mission-critical applications, this is invaluable.

### Understanding the Blue/Green Architecture

Conceptually, blue/green deployments split your infrastructure into two parallel stacks. Each stack is identical in configuration and is independently deployable. In AWS, this typically means two sets of EC2 instances, two ECS task sets, or two Lambda alias versions — the specifics depend on your compute platform.

The critical component that makes blue/green possible is the traffic shift mechanism. In an ECS deployment with an Application Load Balancer (ALB), this means the ALB's target groups point to either the blue or green task set. In a Lambda deployment, it's the routing of traffic between two function alias versions. In EC2-based deployments, it's the Auto Scaling group or load balancer configuration that determines which instances receive traffic.

Here's a concrete scenario: imagine you have an ECS service running the current application version (blue) behind an ALB. Your task definition is registered, and all traffic flows to the blue task set. When you initiate a blue/green deployment, CodeDeploy creates a new task set in green with the updated container image. The deployment doesn't immediately shift traffic; instead, it runs validation tests against green while blue continues serving users. Only after validation passes does CodeDeploy update the ALB to route traffic to green. If validation fails or if alarms trigger during the validation window, CodeDeploy routes traffic back to blue.

### CodeDeploy Blue/Green with ECS and ALB

Let's walk through a practical implementation with ECS and an Application Load Balancer. This is one of the most common patterns for containerized workloads on AWS.

First, you need an AppSpec file. This YAML configuration tells CodeDeploy how to perform the deployment. For ECS blue/green deployments, the AppSpec file is named `appspec.yaml` and lives in your repository root.

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/my-app:5"
        LoadBalancerInfo:
          ContainerName: "my-container"
          ContainerPort: 8080
        PlatformVersion: "1.4.0"
        NetworkConfiguration:
          AwsvpcConfiguration:
            Subnets:
              - "subnet-12345678"
              - "subnet-87654321"
            SecurityGroups:
              - "sg-12345678"
            AssignPublicIp: "ENABLED"

Hooks:
  - BeforeAllowTraffic: "PreTrafficHook"
  - AfterAllowTraffic: "PostTrafficHook"
```

The `Resources` section defines the ECS service being deployed, including the target group name and ALB listener port. The `Hooks` section specifies Lambda functions that CodeDeploy will invoke at specific lifecycle points.

The `BeforeAllowTraffic` hook is particularly important. This hook runs while traffic still flows to blue, but after green is fully deployed and healthy. This is your opportunity to validate that green is functioning correctly. For example, you might run smoke tests, check application health endpoints, or verify database migrations completed successfully.

```python
# Lambda function for BeforeAllowTraffic validation
import json
import boto3
import urllib3

codedeploy = boto3.client('codedeploy')
http = urllib3.PoolManager()

def lambda_handler(event, context):
    deployment_id = event['DeploymentId']
    lifecycle_event_hook_execution_id = event['LifecycleEventHookExecutionId']
    
    # Get information about the green deployment
    # In a real scenario, you'd extract the green task IP or DNS
    green_target = "http://green-task-ip:8080/health"
    
    try:
        # Perform validation - check health endpoint
        response = http.request('GET', green_target, timeout=5)
        
        if response.status == 200:
            status = 'Succeeded'
        else:
            status = 'Failed'
            
    except Exception as e:
        print(f"Validation failed: {str(e)}")
        status = 'Failed'
    
    # Report status back to CodeDeploy
    codedeploy.put_lifecycle_event_hook_execution_status(
        deploymentId=deployment_id,
        lifecycleEventHookExecutionId=lifecycle_event_hook_execution_id,
        status=status
    )
    
    return status
```

This Lambda function performs a simple health check against the green deployment. If the health endpoint returns a 200 status, the validation succeeds and CodeDeploy proceeds with the traffic shift. If any exception occurs or a non-200 status is returned, validation fails and CodeDeploy rolls back by keeping traffic on blue.

The beauty of this approach is flexibility. Your validation logic can be as simple or sophisticated as your application requires. You might check for broken dependencies, run integration tests, verify metrics are within expected ranges, or call your own internal validation service.

### Traffic Shifting Strategies

CodeDeploy offers three traffic shifting strategies, each with different risk profiles and use cases.

**Canary shifts** are the most conservative. You route a small percentage of traffic — typically 5-10% — to green while the majority remains on blue. If no alarms trigger during a brief window (configurable, usually 5-15 minutes), CodeDeploy shifts the remaining traffic. This approach lets you detect problems affecting real users before full cutover, but the limited traffic means you might miss issues that only appear under load.

**Linear shifts** gradually transition traffic from blue to green in equal increments over a longer period. You might shift 10% every 5 minutes until 100% reaches green. This gradual approach gives you more time to observe behavior and notice problems, making it lower risk than canary. However, it extends the deployment window during which you're running two versions simultaneously, consuming more resources.

**All-at-once shifts** move all traffic to green immediately after successful validation. This is the fastest approach and uses resources most efficiently, but it offers no safety margin if validation missed a critical issue. You'd rely entirely on your validation hooks and CloudWatch alarms to catch problems.

Here's how you configure the traffic shift in your CodeDeploy application configuration:

```json
{
  "version": 1,
  "Resources": [
    {
      "TargetService": {
        "Type": "AWS::ECS::Service",
        "Properties": {
          "TaskDefinition": "arn:aws:ecs:us-east-1:123456789012:task-definition/my-app:5",
          "LoadBalancerInfo": {
            "ContainerName": "my-container",
            "ContainerPort": 8080
          }
        }
      }
    }
  ],
  "Hooks": [
    {
      "BeforeAllowTraffic": "PreTrafficValidation"
    }
  ]
}
```

And in your CodeDeploy deployment configuration, you'd specify:

```json
{
  "deploymentType": "BLUE_GREEN",
  "deploymentOption": "WITH_TRAFFIC_CONTROL",
  "trafficRoutingConfig": {
    "type": "CanaryTraffic",
    "timeBasedCanary": {
      "interval": 5,
      "percentage": 10
    }
  }
}
```

The `timeBasedCanary` configuration tells CodeDeploy to shift 10% of traffic to green and wait 5 minutes. If no alarms are triggered during those 5 minutes, it shifts the remaining 90% all at once.

### Validation Windows and Alarm-Triggered Rollback

Understanding the validation window is crucial. This window begins after green is deployed and ends when CodeDeploy completes the traffic shift. During this window, you have an opportunity to validate green's behavior before full production traffic arrives.

Your `BeforeAllowTraffic` hook runs at the beginning of this window, while blue still receives all traffic. This is the ideal time for synthetic tests, health checks, and smoke tests that don't require live production traffic. If this hook returns a failure status, CodeDeploy terminates green and keeps blue running — deployment stops right there.

If your hook succeeds, CodeDeploy begins the traffic shift according to your chosen strategy. Now, real traffic is reaching green. This is where alarms become critical.

You'll define CloudWatch alarms that monitor critical metrics from the green deployment — error rates, latency, CPU utilization, failed health checks, or application-specific metrics. If any alarm transitions to `ALARM` state during the validation window, CodeDeploy automatically rolls back by reverting traffic to blue.

Here's how you'd attach alarms to a deployment:

```json
{
  "alarms": [
    {
      "name": "ApplicationErrorRateHigh"
    },
    {
      "name": "TargetResponseTimeHigh"
    }
  ],
  "triggerConfiguration": {
    "rollbackEvents": ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  ]
}
```

The key setting is `DEPLOYMENT_STOP_ON_ALARM`. When any attached alarm breaches during the validation window, CodeDeploy immediately stops the traffic shift and rolls back to blue. This is a fail-fast approach that prioritizes stability over completing the deployment.

Let's say you have a deployment in the canary phase where 10% of traffic has shifted to green. Your application has a subtle bug that only manifests under certain conditions, and your error rate alarm triggers. CodeDeploy detects this, halts the traffic shift, and routes all traffic back to blue within seconds. Your users experience a brief period of canary-level error rates; your team has clear evidence (the alarm) that green needs fixes; and your system returns to a known good state (blue) autonomously.

### CodeDeploy Blue/Green with AWS Lambda

Lambda deployments follow similar principles but with different mechanics. Lambda doesn't have containers or tasks; instead, you use aliases and versions. The blue environment is the current alias pointing to a stable version; the green environment is the new version that the alias will point to after validation.

Lambda blue/green deployments shift traffic between two function versions using aliases. Your AppSpec file for Lambda looks like this:

```yaml
version: 0.0
Resources:
  - MyFunction:
      Type: AWS::Lambda::Function
      Properties:
        Name: !Ref FunctionName
        Alias: "live"
        CurrentVersion: !Ref FunctionVersion
        TargetVersion: !Ref NewFunctionVersion

Hooks:
  - PreTraffic: "PreTrafficHook"
  - PostTraffic: "PostTrafficHook"
```

The `PreTraffic` hook runs before any traffic shifts to the new version. Like ECS, this is your chance to validate the green function. You might invoke it with test data, check return values, or verify it can access required resources.

```python
import boto3
import json

lambda_client = boto3.client('lambda')
codedeploy = boto3.client('codedeploy')

def lambda_handler(event, context):
    deployment_id = event['DeploymentId']
    lifecycle_event_hook_execution_id = event['LifecycleEventHookExecutionId']
    
    # The new Lambda function version to validate
    function_name = "my-lambda-function"
    new_version = event['FunctionVersion']  # From CodeDeploy
    
    try:
        # Invoke the new version with test data
        response = lambda_client.invoke(
            FunctionName=f"{function_name}:{new_version}",
            InvocationType='RequestResponse',
            Payload=json.dumps({"test": True})
        )
        
        # Check that invocation succeeded
        if response['StatusCode'] == 200:
            payload = json.loads(response['Payload'].read())
            if payload.get('statusCode') == 200:
                status = 'Succeeded'
            else:
                status = 'Failed'
        else:
            status = 'Failed'
            
    except Exception as e:
        print(f"Validation failed: {str(e)}")
        status = 'Failed'
    
    # Report back to CodeDeploy
    codedeploy.put_lifecycle_event_hook_execution_status(
        deploymentId=deployment_id,
        lifecycleEventHookExecutionId=lifecycle_event_hook_execution_id,
        status=status
    )

    return {'statusCode': 200}
```

For Lambda, the traffic shifting happens via alias configuration. The alias `live` initially points to the current version (blue). When deployment starts, CodeDeploy creates a new version (green) and begins routing a portion of traffic to it via `RoutingConfig`. After the validation window passes without alarm triggers, the alias is updated to point entirely to the new version.

Lambda's distributed nature makes it particularly well-suited to blue/green deployments. Since Lambda automatically scales and you don't manage instances, the infrastructure for running two versions in parallel is trivial. The main cost is any resources those functions consume, but blue/green windows are typically measured in minutes, not hours.

### Handling Deployment Failures and Rollback Scenarios

Despite your best validation efforts, deployments sometimes fail. CodeDeploy provides multiple mechanisms for rolling back.

First, there's automatic rollback triggered by alarms. If your green deployment is receiving traffic and a CloudWatch alarm breaches, CodeDeploy immediately reverts traffic to blue. This is the fastest, most autonomous form of rollback and requires zero human intervention.

Second, there's validation hook failure. If your `BeforeAllowTraffic` hook returns a failure status before any traffic shifts to green, CodeDeploy terminates the green deployment and keeps blue running. The deployment is marked as failed, and your team can investigate.

Third, there's manual rollback. Even if CodeDeploy doesn't automatically detect a problem, a human operator can manually trigger a rollback. This is important because not all issues manifest as alarm breaches or validation hook failures. Sometimes a subtle behavioral change takes hours to surface. CodeDeploy lets you stop the deployment and revert traffic to blue at any time.

The validation window duration is configurable and should be set thoughtfully. A 5-minute window catches most obvious problems but might miss slow-developing issues. A 1-hour window gives you time to observe behavior but extends the time you're running two versions. Most organizations set windows between 5 and 30 minutes, depending on how sophisticated their validation is and how confident they are in their testing.

### Best Practices for Blue/Green Deployments

Several practices will significantly improve your blue/green deployment reliability.

**Comprehensive validation hooks** are your first line of defense. Don't just check that the application starts; actually test functionality. Call key API endpoints, verify database connectivity, run smoke tests against important user flows. The more you validate before traffic shifts, the fewer surprises you'll encounter.

**Meaningful alarms** protect you during the traffic shift. Monitor error rates, latency percentiles, and application-specific metrics. Set alarm thresholds based on normal baselines, not arbitrary values. An error rate alarm set to 1% is useless if your application normally runs at 0.1%; it won't trigger in time to catch problems.

**Gradual traffic shifts** reduce risk, especially for critical applications. Canary deployments let you test green with real traffic before committing. Linear shifts give you a longer observation window. The trade-off is resource utilization and deployment duration, but for systems where failures have high business impact, it's worth it.

**Immutable infrastructure** simplifies blue/green. If your deployment process always creates fresh infrastructure rather than modifying existing infrastructure, blue/green becomes cleaner. ECS task sets and Lambda versions naturally fit this model. EC2-based deployments work better when you treat instances as cattle, not pets.

**Clear naming and monitoring** of blue and green versions helps during incidents. Tag your ECS tasks, Lambda versions, or EC2 instances clearly so you know which is blue and which is green. Monitor both versions even after traffic has shifted, so you have historical data if you need to debug why green failed.

**Automated rollback configuration** should be your default. Always attach alarms to deployments. Don't rely on manual rollback as your primary safety mechanism. Automation is faster and never sleeps.

### The Deployment Lifecycle in Detail

Understanding the complete lifecycle helps you troubleshoot issues and design better validation. Here's what happens during a blue/green deployment with ECS:

1. **Initial state**: Blue task set is running, receiving all traffic from the ALB. Green doesn't exist yet.

2. **Deployment initiated**: CodeDeploy creates a new ECS task set with the updated task definition. These are green tasks. They're healthy and running, but the ALB doesn't route traffic to them yet.

3. **BeforeAllowTraffic validation**: Your Lambda hook runs, tests green without production traffic, and returns success or failure. If failure, the deployment stops here and green is terminated.

4. **Traffic shift begins**: The ALB's target group is updated to include the green task set. Depending on your traffic shifting strategy, traffic gradually routes to green.

5. **Validation window**: CloudWatch alarms are monitored. If any breach, traffic reverts to blue immediately.

6. **Successful completion**: After the validation window passes without alarm breaches and the traffic shift completes, the deployment is marked successful. Blue tasks are kept running for a configurable duration (default 1 hour) before termination, providing a fallback option for manual rollback if needed.

7. **Cleanup**: After the retention window, blue tasks are terminated.

Each stage has specific failure modes. A failure at stage 2 means the task definition is invalid or ECS can't place the tasks. A failure at stage 3 means your validation logic identified a problem. A failure at stage 4-5 means either the traffic shift infrastructure has a problem or your application can't handle the transition. Understanding which stage fails helps you debug.

### Monitoring and Observability

Blue/green deployments create unique observability challenges. You're running two versions simultaneously, and traffic distribution is changing over time. Your monitoring strategy needs to capture this.

Create separate dashboards for blue and green. Use CloudWatch target group metrics to see traffic distribution over time. Log which version is handling which requests so you can correlate errors to versions. If you use distributed tracing (like X-Ray), ensure you can identify version information in your traces.

For alarms, consider creating version-specific alarms. An alarm on `TargetGroup-Blue-ErrorRate` tells you explicitly if blue is degrading. This is valuable if blue is still running during traffic shifts; you want to know if your "stable" version is having problems.

Post-deployment, keep logs and metrics from both versions for at least 24 hours. If green behaves fine initially but fails the next day, you want historical data to investigate. If you need to roll back hours after deployment, you want to understand why blue might have drifted during that time.

### Common Pitfalls and How to Avoid Them

Several mistakes appear repeatedly when teams first adopt blue/green deployments.

**Validation hooks that are too lenient** — they succeed even when they shouldn't. If your hook just checks that the application starts, it'll miss most problems. Validate actual functionality. If your smoke tests pass in your CI/CD pipeline but fail against blue/green, your tests aren't comprehensive enough.

**Alarms that don't trigger** — either they're not attached to the deployment, they're misconfigured, or their thresholds are unrealistic. Always test your alarms by intentionally breaking your application and verifying the alarm triggers. Don't assume your alarm configuration is correct.

**Insufficient validation window duration** — if you set it to 1 minute and critical issues take 5 minutes to surface, you'll miss them. Think about what issues your application is prone to and set the window accordingly.

**Not testing rollback** — blue/green is only valuable if rollback actually works. Test rollback in staging. Manually trigger rollbacks and verify traffic returns to blue. Don't discover rollback is broken during a production incident.

**Ignoring blue environment configuration** — just because blue will be terminated doesn't mean you can ignore its resource requests or capacity. Blue receives traffic during the shift; if it's undersized, users experience degradation. Size blue the same as green.

### Conclusion

Blue/green deployments represent a fundamental shift in how you think about releasing software. Instead of viewing deployment as a high-risk moment when your system is in transition, blue/green makes deployment a controlled, reversible process where new versions are validated before users are affected.

CodeDeploy's blue/green implementation removes much of the operational complexity. It handles the infrastructure coordination, traffic shifting, alarm monitoring, and automatic rollback. Your job is to define what validation looks like, configure appropriate alarms, and choose a traffic shifting strategy that matches your risk tolerance.

The key to success is comprehensive validation and meaningful alarms. Validation hooks are your opportunity to catch problems before they affect users. Alarms are your safety net if problems slip through validation. Together, they transform blue/green from an interesting feature into a reliable deployment mechanism that enables your team to release frequently and confidently.

Whether you're building microservices on ECS, serverless applications with Lambda, or traditional EC2-based systems, blue/green deployments provide a proven pattern for achieving near-zero downtime. Start with canary traffic shifts, invest in solid validation hooks, and gradually increase complexity as your confidence grows. Your future self, debugging a production incident at 3 AM, will thank you for having an instant rollback strategy ready.
