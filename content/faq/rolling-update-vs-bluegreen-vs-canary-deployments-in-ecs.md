---
title: "Rolling Update vs Blue/Green vs Canary Deployments in ECS"
---

## Rolling Update vs Blue/Green vs Canary Deployments in ECS

When you're running containerized applications on AWS Elastic Container Service, getting deployments right is critical. A botched rollout can mean downtime, frustrated users, and a scramble to restore service. The good news is that ECS offers multiple deployment strategies, each with distinct strengths and tradeoffs. Whether you're pushing a minor hotfix or a major feature release, understanding the difference between rolling updates, blue/green deployments, and canary strategies will help you choose the approach that matches your risk tolerance, traffic patterns, and business requirements.

This article walks you through each strategy in detail, explores the mechanics of how they work, and shows you concrete configurations you can use right away.

### Understanding ECS Deployments at a Glance

Before diving into the specific strategies, it's worth understanding what happens during any ECS deployment. When you update a service—whether you change the task definition, adjust desired count, or modify configuration—ECS orchestrates the transition from the old task definition to the new one. How that transition occurs is what distinguishes the deployment strategies.

ECS gives you direct control over this process through two key parameters: `minimumHealthyPercent` and `maximumPercent`. These settings define the envelope of change, creating guardrails that ensure your service maintains capacity while transitioning. Together, they shape how many tasks can be stopped, how many new ones can start, and when the old tasks are finally removed.

Think of a deployment like repainting a house. You could paint all the rooms at once and move furniture around frantically (risky, fast), or you could do one room at a time while keeping the house livable (safer, slower). ECS gives you knobs to adjust how that renovation happens.

### Rolling Update: The Default Strategy

A rolling update is ECS's default deployment behavior and often the best choice for applications that can tolerate gradual rollout. The strategy works by steadily replacing old tasks with new ones, maintaining a minimum level of availability throughout the process.

#### How Rolling Updates Work

When you initiate a rolling update, ECS respects the `minimumHealthyPercent` constraint—the minimum percentage of tasks that must remain healthy at any given time. Simultaneously, it respects `maximumPercent`, which caps the total number of running tasks during the transition. By default, these are set to 100% and 200% respectively, meaning ECS will never let your service dip below 100% capacity, but it can temporarily run up to twice the normal number of tasks.

Here's what actually happens: ECS starts new tasks using the updated task definition. Once those tasks pass health checks and report as healthy, ECS begins stopping old tasks. This process repeats in waves until all tasks are running the new definition. If a new task fails its health checks, ECS will stop it and start another, ensuring the minimum is never breached.

The rolling update approach is elegant because it's simple and fault-tolerant. Your load balancer automatically drains connections from tasks being stopped (assuming you've configured connection draining properly), so clients experience a mostly seamless transition. For many applications—APIs, web services, background workers—this is sufficient.

#### Configuring a Rolling Update

In your ECS service definition, the deployment configuration is straightforward:

```json
{
  "serviceName": "my-api-service",
  "desiredCount": 4,
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 100
  },
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:...:targetgroup/my-targets/...",
      "containerName": "api",
      "containerPort": 8080
    }
  ],
  "healthCheckGracePeriodSeconds": 30
}
```

With `desiredCount` set to 4, `minimumHealthyPercent` of 100, and `maximumPercent` of 200, ECS will ensure at least 4 tasks are healthy at all times while allowing up to 8 to run during the transition. This means the service never loses capacity.

If you want a faster rollout with less overhead, you can adjust these values:

```json
{
  "deploymentConfiguration": {
    "maximumPercent": 150,
    "minimumHealthyPercent": 75
  }
}
```

Now ECS can temporarily run down to 3 tasks (75% of 4) and up to 6 (150% of 4). The trade-off is that your available capacity dips during deployment, but new tasks start sooner, so the overall rollout is quicker. This works well for services handling variable traffic or when you have concerns about resource constraints.

#### Health Checks and Rollback in Rolling Updates

The success of a rolling update depends entirely on health checks. ECS uses either ELB target group health checks (if load-balanced) or ECS container health checks to determine if a new task is healthy enough to keep running. If a new task fails these checks repeatedly, ECS will stop it and start another, effectively giving you automatic rollback at the task level.

However, rolling updates don't offer a service-level rollback out of the box. Once a bad deployment progresses far enough, you're stuck. If you realize mid-deployment that the new version has a critical bug, you can't easily flip back to the previous version. You'd need to re-deploy the old task definition, which is a manual action.

This is where CloudWatch alarms can help. By monitoring metrics like task count, error rates, or latency, you can trigger an SNS notification or invoke an automated system to revert the deployment if things go sideways. But it's not built-in—you have to orchestrate it yourself.

### Blue/Green Deployments with CodeDeploy

If rolling updates feel too passive, blue/green deployments offer something more controlled: the ability to fully validate a new version before switching traffic over, and the option to instantly revert if something breaks.

#### The Blue/Green Concept

Blue/green is based on a simple but powerful idea: run two identical environments in parallel. Blue is your current production environment, and green is the new one being prepared. Once green is fully warmed up and validated, you flip traffic from blue to green in one atomic operation. If green has problems, you can flip back to blue immediately.

In the ECS context, this typically means maintaining two separate services, two separate ALB target groups, or using a more sophisticated traffic management layer. When you deploy, you update the green service with the new task definition while blue continues handling traffic. Once green is ready and healthy, you shift traffic over.

#### Implementing Blue/Green with CodeDeploy

AWS CodeDeploy is the recommended way to orchestrate blue/green deployments for ECS. It automates the traffic shifting and rollback, taking the manual work out of the process.

First, you need an AppSpec file that defines how CodeDeploy should orchestrate the deployment:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/my-app:2"
        LoadBalancerInfo:
          ContainerName: "api"
          ContainerPort: 8080
        PlatformVersion: "1.4.0"
        NetworkConfiguration:
          AwsvpcConfiguration:
            Subnets:
              - "subnet-12345678"
            SecurityGroups:
              - "sg-12345678"
            AssignPublicIp: "ENABLED"
Hooks:
  - BeforeAllowTraffic: "arn:aws:lambda:us-east-1:123456789012:function:pre-traffic-hook"
  - AfterAllowTraffic: "arn:aws:lambda:us-east-1:123456789012:function:post-traffic-hook"
```

This AppSpec tells CodeDeploy to update the ECS service with a new task definition, use specific network settings, and invoke validation hooks before and after traffic is shifted. The hooks are Lambda functions that can run tests, health checks, or custom validation logic.

Your CodeDeploy application needs to be created and configured to use this AppSpec:

```bash
aws codedeploy create-app \
  --application-name my-app \
  --compute-platform ECS

aws codedeploy create-deployment-group \
  --application-name my-app \
  --deployment-group-name my-deployment-group \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole \
  --deployment-config-name CodeDeployDefault.ECSCanary10Percent5Minutes \
  --auto-rollback-configuration enabled=true,events=DEPLOYMENT_FAILURE,DEPLOYMENT_STOP_ON_ALARM
```

Notice the deployment config: `CodeDeployDefault.ECSCanary10Percent5Minutes`. This is one of the traffic-shifting strategies CodeDeploy provides, and we'll explore these in depth in the next section.

#### The Role of Target Groups

Blue/green deployments with CodeDeploy rely on the ability to shift traffic between two sets of tasks. This is usually accomplished using two ALB target groups: one for the blue (current) environment and one for the green (new) environment.

When you first set up blue/green with CodeDeploy, you configure the service to use a primary and secondary target group:

```json
{
  "serviceName": "my-app-service",
  "desiredCount": 4,
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-blue/...",
      "containerName": "api",
      "containerPort": 8080
    },
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-app-green/...",
      "containerName": "api",
      "containerPort": 8080
    }
  ],
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 100
  }
}
```

During deployment, CodeDeploy places new tasks in one target group (green) and old tasks in the other (blue). The ALB's listener rules or weighted target groups control the traffic split. As CodeDeploy progresses through its traffic-shifting strategy, it adjusts this split.

### Canary, Linear, and All-at-Once: Traffic-Shifting Strategies

CodeDeploy's traffic-shifting capability isn't a single approach—it's a family of strategies that control how fast traffic moves from blue to green. Each offers different risk profiles.

#### Canary Deployments

A canary deployment shifts a small percentage of traffic to the new version, monitors it for errors or performance issues, and if all is well, shifts the rest. If problems arise, the deployment stops before the majority of traffic is affected.

When you use CodeDeploy's canary strategy, you specify the initial traffic percentage and the interval:

```bash
aws codedeploy create-deployment-group \
  --application-name my-app \
  --deployment-group-name my-app-canary \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole \
  --deployment-config-name CodeDeployDefault.ECSCanary10Percent5Minutes
```

The name itself tells the story: start with 10% traffic, wait 5 minutes, then move to 100%. During that 5-minute window, CloudWatch alarms you've configured are continuously evaluated. If any alarm triggers (such as HTTP 500 errors crossing a threshold or latency spiking), CodeDeploy stops the deployment and can automatically roll back.

Here's a practical example. You're deploying a new version of your payment processing service. You want to be absolutely sure the new code handles transactions correctly. With canary, you route 10% of real transactions to the new version while the old version handles 90%. If the new version processes those transactions without errors and latency remains acceptable, you move to 100%. If there's a surge in errors, CodeDeploy rolls back before the problem reaches all customers.

The AppSpec hook functions are crucial here:

```python
# pre-traffic-hook Lambda function
import json
import boto3

codedeploy = boto3.client('codedeploy')

def lambda_handler(event, context):
    deployment_id = event['DeploymentId']
    lifecycle_event_hook_id = event['LifecycleEventHookExecutionId']
    
    # Run smoke tests against the new green environment
    # Check that the API is responding correctly
    # Verify database migrations completed
    
    try:
        # If tests pass, signal success
        codedeploy.put_lifecycle_event_hook_execution_status(
            deploymentId=deployment_id,
            lifecycleEventHookExecutionId=lifecycle_event_hook_id,
            status='Succeeded'
        )
        return {'statusCode': 200}
    except Exception as e:
        # If tests fail, signal failure and trigger rollback
        codedeploy.put_lifecycle_event_hook_execution_status(
            deploymentId=deployment_id,
            lifecycleEventHookExecutionId=lifecycle_event_hook_id,
            status='Failed'
        )
        return {'statusCode': 500}
```

The pre-traffic hook runs after green is ready but before any traffic is shifted. It's your chance to validate that the new environment is truly healthy and ready for real traffic. The post-traffic hook (if you define one) runs after each traffic shift to verify that the new version is handling the increased load correctly.

#### Linear Deployments

A linear deployment is like canary's more patient sibling. Instead of a single jump to full traffic, it shifts traffic incrementally in equal steps at regular intervals.

CodeDeploy provides linear strategies like `CodeDeployDefault.ECSLinear10PercentEvery3Minutes`:

```bash
aws codedeploy create-deployment-group \
  --application-name my-app \
  --deployment-group-name my-app-linear \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole \
  --deployment-config-name CodeDeployDefault.ECSLinear10PercentEvery3Minutes
```

This shifts 10% of traffic every 3 minutes: 10% at minute 3, 20% at minute 6, 30% at minute 9, and so on until 100% at minute 27. The incremental approach gives you more opportunities to catch problems and a longer window to observe behavior at different traffic levels.

Linear deployments are particularly useful when you're deploying to a large service with complex behavior. A gradual ramp-up lets you observe how the new version performs under increasing load before committing fully. If metrics look good at 10%, they might tell a different story at 60% when all the edge cases start firing.

#### All-at-Once Deployments

The `CodeDeployDefault.ECSAllAtOnce` strategy flips all traffic to the new version immediately. There's no gradual ramp, no intermediate validation—just a cut-over.

All-at-once deployments are high-risk and should be reserved for situations where you have exceptional confidence in the new version, or for non-critical components where a brief outage is acceptable. They're useful for internal services, development environments, or when you've exhausted canary and linear testing and need to go live.

Interestingly, even with all-at-once, you still get rollback capability through CloudWatch alarms and Lambda hooks. If the deployment succeeds but then alarms trigger, CodeDeploy can roll back.

### Rollback Mechanisms Across Strategies

Understanding how rollbacks work is essential because deployments don't always go as planned.

#### Rolling Update Rollbacks

With rolling updates, there's no automatic rollback mechanism. If a bad version makes it through and causes problems, you're doing the rollback manually by re-deploying the previous task definition. This is a limitation that can feel risky for critical services.

However, you can reduce this risk by implementing external monitoring and automation. Use CloudWatch Insights to detect error spikes, create alarms on key metrics, and trigger Lambda functions that automatically initiate a re-deployment of the last known good version. It's more work than built-in rollback, but it's doable.

#### CodeDeploy Rollbacks

CodeDeploy offers native rollback through the `auto-rollback-configuration` parameter:

```bash
aws codedeploy create-deployment-group \
  --application-name my-app \
  --deployment-group-name my-app-blue-green \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole \
  --deployment-config-name CodeDeployDefault.ECSCanary10Percent5Minutes \
  --auto-rollback-configuration \
    enabled=true,\
    events=DEPLOYMENT_FAILURE,DEPLOYMENT_STOP_ON_ALARM,DEPLOYMENT_STOP_ON_TIMEOUT
```

With this configuration, CodeDeploy automatically rolls back if:
- The deployment itself fails (tasks can't start, AppSpec is invalid, etc.)
- Any CloudWatch alarm you've associated with the deployment triggers
- The deployment exceeds a configured timeout

When a rollback occurs, CodeDeploy stops routing traffic to the new green tasks and shifts it back to the blue tasks. Since blue is still running, your service remains available throughout the rollback.

The rollback is nearly instantaneous from a traffic perspective, though cleaning up the failed green tasks takes a few moments. This is the key advantage of blue/green: your old version is still running, so reverting is just a traffic shift, not a re-deployment.

### Comparing the Strategies: When to Use Each

Each strategy has its place, and the right choice depends on your specific context.

**Choose rolling updates when:** You're deploying frequently and confidently. Your application handles gradual task replacement without issues. You have robust health checks and monitoring to detect problems early. You value simplicity and don't want to maintain two parallel environments. Examples include stateless APIs, microservices, and well-tested applications where deployments happen multiple times per day.

Rolling updates also work well when your application is highly fault-tolerant and can handle individual task failures gracefully. If a single task dropping out isn't noticeable, rolling updates are lightweight and efficient.

**Choose blue/green with CodeDeploy when:** You're deploying to critical services where downtime is costly. You want the ability to instantly revert to the previous version if problems emerge. You need to validate the new version in production-like conditions before full traffic shift. You're making significant changes that warrant careful, controlled progression. Examples include payment systems, authentication services, and customer-facing applications where a bad deployment affects revenue or brand.

Blue/green deployments cost more in resources (you're running two full environments) and are more operationally complex, but they give you safety guarantees that rolling updates don't provide.

**Choose canary deployments when:** You're rolling out significant changes but want to limit blast radius. You have good monitoring and alerting in place. You can afford a few minutes of partial traffic shift. You want automated rollback based on metrics. Canary is ideal for features that might have subtle bugs or performance issues that won't show up in testing. You detect them with 10% of real traffic, then either complete the deployment or roll back.

**Choose linear deployments when:** You're in between canary and all-at-once in terms of risk tolerance. You want to observe performance across multiple traffic levels. You have services with bursty or variable behavior where you need time to observe at each level. Linear is like canary's cautious cousin—it takes longer but gives you more observation windows.

**Choose all-at-once when:** You've already validated extensively through canary or linear. You're deploying to non-critical components. You have exceptional confidence in the new version. You need the deployment to complete quickly. All-at-once is rare for critical services but useful for internal tools and components.

### Practical Deployment Scenario: Putting It All Together

Let's walk through a realistic scenario to see how these concepts come together.

You're deploying a new recommendation engine to your e-commerce platform. The old version has been stable for months, but the new one uses a different algorithm and could behave unexpectedly under load.

First, you'd prepare a new task definition with the new code:

```json
{
  "family": "recommendation-service",
  "taskRoleArn": "arn:aws:iam::123456789012:role/ecsTaskRole",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "recommendation-engine",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/recommendation-service:v2.1.0",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/recommendation-service",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 10
      }
    }
  ]
}
```

You'd register this new task definition:

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

Next, you'd set up your ECS service for blue/green deployment with dual target groups:

```json
{
  "serviceName": "recommendation-service",
  "cluster": "production",
  "taskDefinition": "recommendation-service:1",
  "desiredCount": 6,
  "launchType": "FARGATE",
  "platformVersion": "1.4.0",
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["subnet-12345678", "subnet-87654321"],
      "securityGroups": ["sg-12345678"],
      "assignPublicIp": "ENABLED"
    }
  },
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/recommendation-blue/...",
      "containerName": "recommendation-engine",
      "containerPort": 8080
    },
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/recommendation-green/...",
      "containerName": "recommendation-engine",
      "containerPort": 8080
    }
  ],
  "deploymentConfiguration": {
    "maximumPercent": 200,
    "minimumHealthyPercent": 100
  }
}
```

Now you'd create a CodeDeploy application and deployment group:

```bash
aws codedeploy create-app \
  --application-name recommendation-service

aws codedeploy create-deployment-group \
  --application-name recommendation-service \
  --deployment-group-name blue-green-canary \
  --service-role-arn arn:aws:iam::123456789012:role/CodeDeployRole \
  --deployment-config-name CodeDeployDefault.ECSCanary10Percent5Minutes \
  --auto-rollback-configuration \
    enabled=true,\
    events=DEPLOYMENT_FAILURE,DEPLOYMENT_STOP_ON_ALARM \
  --alarm-configuration \
    enabled=true,\
    alarms=[{name=RecommendationErrorRate},{name=RecommendationLatency}]
```

You'd create an AppSpec file for the deployment:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/recommendation-service:2"
        LoadBalancerInfo:
          ContainerName: "recommendation-engine"
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
  - BeforeAllowTraffic: "arn:aws:lambda:us-east-1:123456789012:function:validate-recommendations"
  - AfterAllowTraffic: "arn:aws:lambda:us-east-1:123456789012:function:monitor-recommendations"
```

Then you'd create the deployment:

```bash
aws codedeploy create-deployment \
  --application-name recommendation-service \
  --deployment-group-name blue-green-canary \
  --description "Deploy recommendation engine v2.1.0" \
  --s3-location s3://my-bucket/appspec.yaml
```

CodeDeploy would then:
1. Start new tasks with the v2.1.0 image in the green target group
2. Run the pre-traffic validation Lambda to ensure the new version is healthy
3. Shift 10% of traffic to green, 90% to blue
4. Monitor the CloudWatch alarms for 5 minutes
5. If alarms don't trigger, shift remaining 90% to green
6. Monitoring continues during the rest of the deployment

If at any point an alarm triggers (error rate spikes, latency increases, etc.), CodeDeploy automatically rolls back: traffic goes back to blue, new tasks stop, and your service continues with the old version.

### Monitoring and Observability During Deployments

Regardless of which strategy you choose, deployment success depends on visibility. You need to know what's happening as changes roll out.

CloudWatch is your primary tool. Create dashboards that show key metrics during deployments: task count, error rates, latency percentiles, and throughput. These metrics should feed into alarms that CodeDeploy monitors.

For CodeDeploy deployments specifically, the deployment history is visible in the AWS console and via CLI:

```bash
aws codedeploy get-deployment \
  --deployment-id d-XXXXXXXXX
```

This gives you the deployment status, which tasks are in which target group, and links to the CloudWatch logs for any Lambda hook functions that ran.

Inside your application, structured logging is crucial. Log enough detail to trace what the new version is doing differently from the old. If a canary deployment starts showing elevated errors, logs should tell you whether it's a database query issue, a missing configuration, or something else.

Use X-Ray or similar tracing to correlate requests across services. If the recommendation service changed but also depends on a user profile service, and the profile service is experiencing issues, your metrics will show elevated latency in recommendations, but the root cause is elsewhere. Tracing helps you see that.

### Cost and Resource Implications

Each strategy has different resource and cost profiles worth considering.

Rolling updates are the most efficient. You briefly run more tasks than usual (up to `maximumPercent`), but the footprint is temporary. Once the deployment completes, you're back to the desired count. For a service with 10 tasks and `maximumPercent` of 150%, you might briefly run 15 tasks, then drop back to 10.

Blue/green deployments are more expensive. You're running two complete sets of tasks throughout the deployment. With 10 tasks per environment, you're running 20. After the deployment completes, you'll typically scale the blue environment down to zero or keep it running briefly in case a rollback is needed.

If you do keep both environments running for quick rollback, the cost is double until you decommission blue. If you scale blue to zero immediately after a successful green deployment, you're only paying double during the deployment window, which is typically minutes to an hour.

Canary and linear deployments with CodeDeploy use blue/green infrastructure, so they carry the same cost as blue/green. The traffic-shifting happens at the load balancer level (no extra tasks), but the two environments need to be running to enable instant rollback.

For large applications running 24/7, the cost difference between strategies is significant. A service with 100 tasks that scales blue/green deployments costs roughly double the infrastructure cost during deployment. If you deploy once per week for an hour, that's about 4 hours per week of double infrastructure cost, or roughly 7-8% overhead. For services deploying multiple times per day, the overhead grows.

This is why many teams use rolling updates for low-risk deployments and blue/green for high-risk ones. You don't need to use the same strategy everywhere.

### Choosing Your Monitoring and Alarming Strategy

The success of any deployment strategy relies on knowing when something is wrong. With rolling updates, detection must be external and automated. With CodeDeploy strategies, you bake alarms into the deployment itself.

For rolling updates, consider setting up CloudWatch alarms on metrics like:
- HTTP 5xx error rate (threshold: >1% above baseline)
- Request latency (p99 threshold: >150% of baseline)
- Task health check failures (count > 0 for more than 2 minutes)
- Database connection errors (threshold: >5% of baseline)

Then use SNS to notify on-call engineers immediately. As an additional layer, create a Lambda that listens to these alarms and automatically triggers a rollback deployment if the severity is high enough.

For CodeDeploy blue/green deployments, add these same alarms to the deployment group's `alarmConfiguration`. CodeDeploy will monitor them throughout the deployment and roll back if any trigger. This is more reliable than manual intervention because it's automated and doesn't depend on someone noticing a notification.

Additionally, use the Lambda hook functions to run application-specific tests. For a recommendation service, your pre-traffic hook might:
- Hit the `/health` endpoint and verify database connectivity
- Request a set of known user IDs and verify recommendations are returned
- Validate that new recommendations differ from the old algorithm (or are expected to be the same, depending on your change)
- Run a smoke test against key API endpoints

Your post-traffic hook (after each traffic shift) might:
- Sample requests to verify response structure is correct
- Check error logs for exceptions specific to the new version
- Verify that critical business metrics (conversion rate, if applicable) haven't degraded

### Common Pitfalls and How to Avoid Them

**Pitfall: Insufficient health checks** – If your container health check is too lenient, ECS will mark a broken container as healthy, and rolling updates will proceed with broken tasks. Use actual application checks (HTTP requests to key endpoints) not just process checks.

**Solution:** In your task definition, use meaningful health checks that exercise your application's logic. A simple "is the process running" is insufficient.

**Pitfall: Forgetting connection draining** – Without connection draining configured on your ALB target groups, connections to tasks being stopped might be abruptly closed, causing user-visible errors.

**Solution:** Set the deregistration delay (connection draining timeout) to at least 30 seconds on your target groups. Give in-flight requests time to complete.

**Pitfall: Alarms too sensitive or too broad** – If your CloudWatch alarms for rollback trigger on normal variance in metrics, you'll roll back deployments that are actually fine. If they're too broad (e.g., "any latency spike"), you'll abandon good deployments.

**Solution:** Baseline your metrics over several days before setting alarm thresholds. Use anomaly detection alarms instead of static thresholds. Test alarms in non-critical deployments first.

**Pitfall: Blue/green without proper cleanup** – If you deploy multiple times without cleaning up old task definitions, your ECR registry and ECS task definition list will explode. Blue/green itself doesn't clean up; you need to.

**Solution:** Use lifecycle policies on your ECR repositories to delete old image tags. Periodically deregister old task definition revisions. Automate this via Lambda if you deploy frequently.

**Pitfall: Deploying untested code** – No deployment strategy will save you from deploying broken code to production. Canary and CodeDeploy give you escape hatches, but they're not replacements for testing.

**Solution:** Use the testing and staging environments to validate thoroughly before production deployments. Your pre-traffic Lambda hooks should run automated tests, but manual testing in staging is irreplaceable.

### Moving Forward: Evolving Your Deployment Strategy

As your systems mature, your deployment strategy will evolve.

Start with rolling updates for simplicity and low cost. If you encounter issues that would benefit from faster rollback, implement blue/green with CodeDeploy. As your deployment confidence grows, you'll find the sweet spot for each service: low-risk internal APIs might stay on rolling updates, while customer-facing services graduate to canary deployments.

Combine strategies with your organizational maturity. Newer services or teams new to ECS can use rolling updates with good monitoring. Established services with dedicated deployment expertise can leverage the power of blue/green and canary strategies.

Automation is your friend. Manually managing deployments doesn't scale. Use CodeDeploy, CodePipeline, and infrastructure-as-code to make deployments repeatable and audit-able. Write those Lambda hooks. Build those dashboards. As you do, deployments become safer, faster, and less stressful.

The right deployment strategy is the one that balances your risk tolerance, your resource budget, and your operational capacity. Understand the tradeoffs, start conservatively, and evolve as your needs change.
