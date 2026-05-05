---
title: "SAM CodeDeploy Integration: Automated Traffic Shifting and Gradual Rollouts"
---

## SAM CodeDeploy Integration: Automated Traffic Shifting and Gradual Rollouts

Modern application deployment isn't just about pushing code to production—it's about doing so safely, predictably, and with the ability to roll back instantly if something goes wrong. AWS Serverless Application Model (SAM) elegantly solves this challenge by integrating with AWS CodeDeploy to enable sophisticated traffic shifting strategies that let you catch problems before they affect all your users.

If you've deployed a Lambda function and worried about the blast radius of a bad deployment, or if you've wanted a way to gradually introduce new code to production traffic, SAM's CodeDeploy integration is exactly what you need. This article walks you through how SAM orchestrates CodeDeploy to automate safe deployments, explores each traffic shifting strategy in detail, and shows you how to instrument your deployments with alarms that trigger automatic rollbacks when things go wrong.

### Understanding the Problem: Why Gradual Rollouts Matter

Consider a scenario: you've written a Lambda function that handles your e-commerce checkout process. The new version includes optimizations to reduce latency. You deploy it using traditional methods, and suddenly 100% of your traffic goes to the new code. Within seconds, you discover a bug that only manifests under specific payment gateway conditions. Now you're scrambling to revert while customers see errors.

With a gradual rollout strategy, you could have started by routing just 10% of traffic to the new version, monitored it for a few minutes, then incrementally shifted more traffic. The bug would have been caught with minimal customer impact, and you could have rolled back automatically based on CloudWatch alarm thresholds.

This is the power of traffic shifting, and AWS SAM makes implementing it straightforward by managing the underlying CodeDeploy resources for you.

### The SAM + CodeDeploy Foundation

When you configure SAM to use CodeDeploy for Lambda deployments, you're instructing SAM to create a CodeDeploy application and deployment group that orchestrates traffic shifting between Lambda versions. Rather than updating your Lambda function's alias to point directly to a new version, SAM leverages CodeDeploy's hooks to gradually shift traffic based on a predefined strategy.

The key to understanding this integration is recognizing that SAM acts as a template generator. You specify your deployment preferences in the SAM template using simple configuration, and SAM synthesizes the necessary CloudFormation resources—including the CodeDeploy application, deployment group, and associated IAM roles—during the build and deployment process.

### AutoPublishAlias: The Traffic Shifting Enabler

Before diving into deployment strategies, you need to understand `AutoPublishAlias`. This is a SAM-specific property that tells SAM to automatically create and manage a Lambda alias that will be updated during deployments.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2010-05-13

Globals:
  Function:
    Timeout: 30
    Runtime: python3.11
    Environment:
      Variables:
        TABLE_NAME: !Ref OrderTable

Resources:
  CheckoutFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: checkout-processor
      CodeUri: src/
      Handler: app.lambda_handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref OrderTable
      AutoPublishAlias: live
      DeploymentPreference:
        Type: Canary10Percent5Minutes
        Alarms:
          - !Ref CheckoutErrorAlarm
        TriggerConfigurations:
          - DeploymentEventFilter:
              TriggerEvents:
                - DeploymentSuccess
                - DeploymentFailure

  CheckoutErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: checkout-function-errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 60
      EvaluationPeriods: 1
      Threshold: 5
      ComparisonOperator: GreaterThanOrEqualToThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref CheckoutFunction

  OrderTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: orders
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: order_id
          AttributeType: S
      KeySchema:
        - AttributeName: order_id
          KeyType: HASH
```

In this example, `AutoPublishAlias: live` tells SAM to create (or manage) a Lambda alias named `live`. Every time you deploy, SAM uses CodeDeploy to shift traffic from the current version to the new version according to your `DeploymentPreference` specification.

Without `AutoPublishAlias`, you're deploying the function directly, and the alias (if you've created one) isn't updated by CodeDeploy. With it, you unlock traffic shifting capabilities.

### Deployment Preference Strategies

SAM supports three primary traffic shifting strategies through the `DeploymentPreference.Type` property: `Canary`, `Linear`, and `AllAtOnce`. Each strategy balances risk differently and suits different deployment scenarios.

#### Canary Deployments

A Canary deployment shifts a small percentage of traffic to the new version for a brief period, then—if all is well—shifts the remaining traffic. This strategy gets its name from the historical practice of sending canaries into coal mines to detect hazardous gases before human miners entered.

The configuration `Canary10Percent5Minutes` means: route 10% of traffic to the new version, wait 5 minutes, then shift the remaining 90% if no alarms have triggered.

```yaml
DeploymentPreference:
  Type: Canary10Percent5Minutes
  Alarms:
    - !Ref CheckoutErrorAlarm
```

Why use Canary? It's ideal when you want rapid validation with minimal blast radius. If your function handles 100 requests per minute, a 10% canary only exposes the new code to about 10 requests. If there's a problem, you catch it quickly with limited customer impact.

The available canary configurations are:
- `Canary10Percent5Minutes`: 10% of traffic for 5 minutes
- `Canary10Percent30Minutes`: 10% of traffic for 30 minutes
- `Canary5Percent5Minutes`: 5% of traffic for 5 minutes

Choose the variant based on how long you need to observe the new version. If your function has long-running batch jobs, you might need more observation time. If it handles quick synchronous requests, 5 minutes might suffice.

#### Linear Deployments

Linear deployments increment traffic to the new version gradually in equal steps over a defined period. `Linear10Percent10Minutes` increases traffic by 10% every minute for 10 minutes, reaching 100% at the end.

```yaml
DeploymentPreference:
  Type: Linear10Percent10Minutes
  Alarms:
    - !Ref CheckoutErrorAlarm
```

Linear deployments are excellent for detecting degradation that emerges gradually rather than catastrophically. If a new version has a memory leak, it won't show up immediately in a canary; the leak compounds over time. A linear deployment gives the memory usage time to climb, allowing alarms to trigger before all traffic is shifted.

Available linear configurations include:
- `Linear10Percent10Minutes`: Increase by 10% every minute
- `Linear10Percent30Minutes`: Increase by 10% every 3 minutes
- `Linear5Percent5Minutes`: Increase by 5% every minute

#### AllAtOnce Deployments

`AllAtOnce` immediately shifts all traffic to the new version without gradual rollout. This is the fastest deployment but the riskiest.

```yaml
DeploymentPreference:
  Type: AllAtOnce
  Alarms:
    - !Ref CheckoutErrorAlarm
```

Use `AllAtOnce` only when you have high confidence in your changes and robust alarm coverage. It's appropriate for critical bug fixes where the old version is actively causing problems, or for minor changes backed by thorough testing.

### Implementing Cloudwatch Alarms for Automatic Rollback

The true power of SAM's CodeDeploy integration emerges when you pair traffic shifting with CloudWatch alarms. If an alarm breaches during deployment, CodeDeploy automatically rolls back to the previous version.

Here's how to think about alarm configuration: your alarm should measure something that directly indicates a problem in your function. Common choices include:

**Error rate**: Count the number of function errors and trigger rollback if it exceeds a threshold.

```yaml
ErrorRateAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: checkout-function-error-rate
    MetricName: Errors
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 60
    EvaluationPeriods: 1
    Threshold: 10
    ComparisonOperator: GreaterThanOrEqualToThreshold
    Dimensions:
      - Name: FunctionName
        Value: !Ref CheckoutFunction
```

**Duration (latency)**: Monitor how long the function takes to complete. Unexpected slowdowns often signal problems.

```yaml
DurationAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: checkout-function-duration
    MetricName: Duration
    Namespace: AWS/Lambda
    Statistic: Average
    Period: 60
    EvaluationPeriods: 2
    Threshold: 5000
    ComparisonOperator: GreaterThanThreshold
    Dimensions:
      - Name: FunctionName
        Value: !Ref CheckoutFunction
```

**Throttles**: If your function begins experiencing throttling, that's a sign something is consuming resources unexpectedly.

```yaml
ThrottleAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: checkout-function-throttles
    MetricName: Throttles
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 60
    EvaluationPeriods: 1
    Threshold: 1
    ComparisonOperator: GreaterThanOrEqualToThreshold
    Dimensions:
      - Name: FunctionName
        Value: !Ref CheckoutFunction
```

**Custom metrics**: If none of these standard metrics capture the problem, you can publish custom metrics from your function code.

```python
import boto3
import json

cloudwatch = boto3.client('cloudwatch')

def lambda_handler(event, context):
    try:
        # Your checkout logic here
        result = process_payment(event)
        
        # Publish a custom metric indicating success
        cloudwatch.put_metric_data(
            Namespace='CheckoutMetrics',
            MetricData=[
                {
                    'MetricName': 'PaymentSuccess',
                    'Value': 1,
                    'Unit': 'Count'
                }
            ]
        )
        
        return {'statusCode': 200, 'body': json.dumps(result)}
    except Exception as e:
        cloudwatch.put_metric_data(
            Namespace='CheckoutMetrics',
            MetricData=[
                {
                    'MetricName': 'PaymentFailure',
                    'Value': 1,
                    'Unit': 'Count'
                }
            ]
        )
        raise
```

When you add multiple alarms to your deployment preference, CodeDeploy monitors all of them. If any alarm enters the `ALARM` state during the deployment window, CodeDeploy immediately halts traffic shifting and rolls back to the previous version. This means you don't have to manually intervene—the system protects itself.

### How SAM Generates CodeDeploy Resources

Understanding what SAM generates behind the scenes demystifies the integration and helps you troubleshoot issues. When you deploy a SAM template with `AutoPublishAlias` and `DeploymentPreference`, SAM synthesizes several CloudFormation resources:

**AWS::CodeDeploy::App**: A CodeDeploy application (not to be confused with the Lambda function itself). This is a logical container for deployments.

**AWS::CodeDeploy::DeploymentGroup**: Defines how deployments happen—which version gets traffic, how traffic shifts, and which alarms to monitor.

**AWS::Lambda::Alias**: The alias that clients invoke. This alias points to different versions depending on the deployment state.

**IAM roles**: Service roles granting CodeDeploy permission to update the Lambda alias and read CloudWatch alarms.

You can inspect these resources by examining the CloudFormation stack after deployment. In the AWS Console, navigate to CloudFormation, find your stack, and view the Resources tab. You'll see the CodeDeploy application and deployment group alongside your Lambda function.

Why is this useful? When deployment behaves unexpectedly, you can check the CodeDeploy deployment history directly. CodeDeploy provides detailed logs showing which traffic percentage was shifted at each step, when alarms triggered, and why a rollback occurred.

### A Concrete Walkthrough: Canary Deployment with Automatic Rollback

Let's trace through a real deployment scenario step by step. Imagine you've deployed the checkout function above with `Canary10Percent5Minutes`. Here's what happens:

**Step 1: Deployment Initiation**

You run `sam deploy`, and SAM packages your function code and uploads it to S3. CloudFormation creates a new Lambda function version (e.g., version 42). SAM's template specifies that CodeDeploy should manage the `live` alias.

**Step 2: Canary Phase Begins**

CodeDeploy begins the deployment by updating the `live` alias to split traffic: 90% to the previous version (version 41) and 10% to the new version (version 42). CloudWatch begins monitoring your alarms.

Within seconds, 10% of incoming requests route to version 42. If you're processing 100 requests per minute, about 10 requests now execute the new code.

**Step 3: Monitoring and Detection**

The second request on version 42 hits an unhandled edge case in your new payment processing logic. The function throws an exception, incrementing the Errors metric. Several requests fail in quick succession. Within 60 seconds (your alarm period), the Errors metric exceeds 10.

CloudWatch evaluates the alarm condition, detects that the threshold has been breached, and transitions the alarm to the `ALARM` state.

**Step 4: Automatic Rollback**

CodeDeploy continuously monitors the alarms you specified in the `DeploymentPreference`. The moment the alarm enters `ALARM` state, CodeDeploy halts the deployment and initiates a rollback. It updates the `live` alias to route 100% of traffic back to version 41.

**Step 5: Deployment Cleanup**

CodeDeploy marks the deployment as failed in its history. The Lambda function version 42 remains in your account (you can view it and analyze the code), but no traffic routes to it. You can now investigate what went wrong, fix the code, and redeploy.

The entire process—from triggering the canary to executing automatic rollback—happens without manual intervention. Your customers experienced a brief blip (roughly 10 requests on the bad version) but no sustained outage.

### Practical Implementation Details

When you use SAM with CodeDeploy, several practical considerations emerge:

**Alias invocation**: Make sure your application invokes the alias, not the function directly. If you have infrastructure that hard-codes the function name in invocation calls, traffic shifting won't work because the function doesn't change—only the alias does.

For example, your API Gateway should invoke the `live` alias:

```yaml
CheckoutApi:
  Type: AWS::Serverless::Api
  Properties:
    StageName: prod

CheckoutIntegration:
  Type: AWS::ApiGateway::Integration
  Properties:
    FunctionName: !Sub '${CheckoutFunction.Arn}:live'
    HttpMethod: POST
    IntegrationHttpMethod: POST
```

**Alarm evaluation periods**: Set your alarm's `EvaluationPeriods` carefully. If you set it to 1 and your period is 60 seconds, the alarm evaluates immediately after the first minute. This catches issues quickly but might trigger on temporary blips. Setting `EvaluationPeriods: 2` requires two consecutive periods of bad metrics before triggering, reducing false positives.

**Alarm action permissions**: CodeDeploy needs permission to read your CloudWatch alarms. When you use SAM, it automatically generates the necessary IAM policies, but if you create alarms outside SAM, ensure the CodeDeploy service role includes `cloudwatch:DescribeAlarms` permission.

**Reserved concurrency and provisioned concurrency**: If your function uses reserved or provisioned concurrency, CodeDeploy manages this appropriately during deployment. Provisioned concurrency is updated to the new version as traffic shifts, ensuring consistent performance.

**Post-deployment validation**: After a successful canary deployment, CodeDeploy automatically completes the second phase and shifts remaining traffic. You don't need to manually approve anything unless you configure explicit approval steps (an advanced scenario beyond this article's scope).

### Troubleshooting Common Deployment Issues

Even with excellent setup, deployments sometimes behave unexpectedly. Here are common scenarios and how to diagnose them:

**Deployment never completes**: If your deployment seems stuck on the canary phase, check your CloudWatch alarms. If an alarm is in the `ALARM` state but hasn't breached your rollback threshold, CodeDeploy holds traffic at the canary level. Verify your alarm configuration is what you intended.

**False-positive rollbacks**: If you're rolling back on valid deployments, your alarms might be too sensitive. Increase thresholds or evaluation periods. For example, if a function occasionally takes longer than normal but is still healthy, a lower duration threshold might cause unnecessary rollbacks.

**Alias not updating**: If the alias doesn't reflect the new version after deployment completes, ensure you're invoking the alias, not the function name. Also verify that CodeDeploy has permission to update Lambda aliases through its service role.

**Missing alarms**: If you specify alarms in `DeploymentPreference` but CodeDeploy doesn't seem to check them, verify that the alarms exist and are in the same region as your function. CodeDeploy can't monitor cross-region alarms.

### Advanced: Custom Alarms and Application Insights

For sophisticated applications, standard Lambda metrics might not tell the whole story. That's when custom CloudWatch metrics and Application Insights become valuable.

Application Insights is an AWS feature that monitors applications and automatically detects problems based on application-level metrics. For a Lambda-based checkout function, Application Insights might track failed payment transactions, timeouts from downstream APIs, or database connection pool exhaustion—metrics that directly indicate application health rather than just function-level health.

Creating custom metrics from your function gives you fine-grained control:

```python
def lambda_handler(event, context):
    cloudwatch = boto3.client('cloudwatch')
    
    try:
        order = event.get('order')
        payment_result = charge_card(order)
        
        cloudwatch.put_metric_data(
            Namespace='Checkout',
            MetricData=[
                {
                    'MetricName': 'TransactionSuccess',
                    'Value': 1,
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                }
            ]
        )
        
        return {'statusCode': 200, 'body': json.dumps(payment_result)}
        
    except CardDeclinedException:
        cloudwatch.put_metric_data(
            Namespace='Checkout',
            MetricData=[
                {
                    'MetricName': 'CardDeclined',
                    'Value': 1,
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                }
            ]
        )
        return {'statusCode': 402, 'body': json.dumps({'error': 'payment_declined'})}
```

Then define an alarm on this custom metric:

```yaml
CardDeclineAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: excessive-card-declines
    MetricName: CardDeclined
    Namespace: Checkout
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 1
    Threshold: 50
    ComparisonOperator: GreaterThanThreshold
```

If a new version has a bug that causes incorrect card validation, triggering more declines than normal, this alarm will breach and trigger a rollback.

### Monitoring Deployment Progress

During deployment, you have several ways to monitor progress:

**CodeDeploy console**: Navigate to CodeDeploy in the AWS Console, select your application, and view the deployment history. You'll see each deployment's status, traffic percentage at each step, and any alarms that triggered.

**SAM CLI**: Running `sam deploy` with the `--no-fail-on-empty-changeset` flag allows you to see deployment logs as they happen.

**CloudWatch logs**: CodeDeploy publishes deployment events to CloudWatch if you've configured it. These logs show exactly when traffic shifted and when alarms were evaluated.

**Lambda Insights**: For deeper visibility into function behavior during deployment, enable Lambda Insights monitoring on your function. This provides detailed performance metrics and can reveal issues like resource contention that standard metrics might miss.

### Summary

SAM's CodeDeploy integration transforms Lambda deployments from an all-or-nothing operation into a controlled, observable process. By configuring `AutoPublishAlias` and `DeploymentPreference`, you gain the ability to gradually introduce new code to production, automatically detect problems through CloudWatch alarms, and roll back instantly if something goes wrong.

The three deployment strategies—Canary, Linear, and AllAtOnce—address different deployment scenarios. Canary deployments minimize risk by exposing new code to a small percentage of traffic briefly. Linear deployments catch problems that emerge gradually over time. AllAtOnce deployments offer speed when you have high confidence.

Behind the scenes, SAM generates the necessary CodeDeploy application, deployment group, aliases, and IAM roles, abstracting away the complexity. You specify your deployment preferences declaratively in your SAM template, and the infrastructure handles the implementation.

By pairing traffic shifting with well-chosen CloudWatch alarms—monitoring error rates, latency, throttling, or custom application metrics—you create a self-healing deployment system that protects both your users and your team. Problems are caught early, blast radius is minimized, and rollbacks happen automatically without requiring manual intervention in the middle of the night.

As you build serverless applications, thoughtfully applying these deployment patterns transforms how you think about production deployments: not as risky events requiring careful coordination, but as automated, safe processes you can execute with confidence.
