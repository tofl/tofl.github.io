---
title: "EventBridge Input Transformer: Reshaping Events Before Delivery to Targets"
---

## EventBridge Input Transformer: Reshaping Events Before Delivery to Targets

Event-driven architecture thrives on loose coupling, but that freedom comes with a price: events rarely arrive in the exact shape your targets expect. You might have a CloudWatch alarm that fires with a verbose schema, but your Lambda function wants only three specific fields. Or perhaps you're sending events to a Slack webhook that demands a particular JSON structure. Without a way to transform these events, you're forced to write boilerplate code in every consumer—Lambda functions full of field extraction, API destination integrations that mangle payloads, SQS messages that waste bandwidth with irrelevant data.

EventBridge's input transformer feature solves this problem elegantly. Instead of pushing transformation logic into your targets, you reshape events right at the rule level—before they ever leave EventBridge. This tutorial walks you through the mechanism, shows you how to think about transformations, and provides concrete examples you'll recognize from real-world scenarios.

### Understanding the Two-Step Transformation Model

EventBridge's input transformer works in exactly two steps, and understanding this model is the key to using it effectively. Think of it as a pipeline: first you *extract* values from the incoming event, then you *assemble* a new payload using those values plus any static content you want to inject.

The first step is called **InputPathsMap**. This is where you use JSONPath expressions to pluck specific values from your incoming event and give them memorable names. For example, if a CloudWatch event arrives with deeply nested information, you might extract the alarm name into a variable you'll call `alarm_name`, the region into `region`, and the timestamp into `event_time`. These extracted values don't go anywhere yet—they're just stored in a temporary namespace, available for the next step.

The second step is **InputTemplate**. This is where you build the actual payload that will be sent to your target. You construct either a JSON object or a plain text string, using placeholders to reference the values you extracted in step one. You can also hardcode static values directly into the template—perhaps a fixed slack channel name, or a routing key that directs the message to the right service downstream.

Let's look at a simple example to anchor this concept. Suppose an EC2 instance state-change event arrives at EventBridge. The raw event might look like this:

```json
{
  "version": "0",
  "id": "12345",
  "detail-type": "EC2 Instance State-change Notification",
  "source": "aws.ec2",
  "account": "123456789012",
  "time": "2024-01-15T14:30:00Z",
  "region": "us-east-1",
  "detail": {
    "instance-id": "i-0abcd1234efgh5678",
    "state": "stopped",
    "reason-code": "User initiated"
  }
}
```

Now imagine your Lambda function only cares about the instance ID, the new state, and wants to know which AWS region this happened in. Your InputPathsMap might look like:

```json
{
  "instance_id": "$.detail.instance-id",
  "state": "$.detail.state",
  "region": "$.region"
}
```

And your InputTemplate could be:

```json
{
  "instanceId": "<instance_id>",
  "newState": "<state>",
  "awsRegion": "<region>",
  "processedBy": "EventBridge Transformer"
}
```

When this rule fires, EventBridge evaluates the JSONPath expressions against the incoming event, extracts those three values, and then builds the new payload using the template. Your Lambda receives exactly what it expects, with field names it recognizes, and no irrelevant noise.

### JSONPath Extraction with InputPathsMap

JSONPath is a query language for navigating JSON structures, and it's the mechanism EventBridge uses to find and extract values from your event. If you've never used JSONPath before, the good news is that EventBridge supports a straightforward subset—you don't need to learn the entire specification.

The basic syntax uses dot notation to descend into nested objects. A `$` symbol represents the root of the event, so `$.region` accesses the `region` field at the top level. To go deeper, you chain dots: `$.detail.instance-id` navigates into the `detail` object and retrieves the `instance-id` field. If a field name contains hyphens or other special characters, JSONPath requires you to quote it: `$.detail['instance-id']` is equivalent.

You can also index into arrays. If your event contains an array called `resources` and you want the first element, use `$.resources[0]`. To access nested array elements, continue the chain: `$.resources[0].arn` gets the `arn` field from the first resource in the array.

Here's a practical tip: EventBridge's JSONPath implementation doesn't support wildcard queries or complex filtering expressions—those advanced features simply aren't available. You're limited to direct path navigation and array indexing. This is actually a feature, not a limitation, because it keeps transformations predictable and efficient.

When you define your InputPathsMap, you're creating a key-value dictionary. The key becomes the placeholder name you'll use in your template, and the value is the JSONPath expression. Make your keys meaningful: instead of `path1` and `path2`, use `alarm_name` and `threshold_value`. Future you will thank present you when you're debugging a rule six months later.

### Building New Payloads with InputTemplate

The InputTemplate is where your extracted values come to life. You can build either JSON objects or plain text strings, depending on what your target expects.

For JSON payloads, the template is itself a JSON object where you reference extracted values using angle-bracket syntax: `<your_variable_name>`. Let's say you extracted `alarm_name`, `severity`, and `timestamp`. Your template might be:

```json
{
  "alert": {
    "name": "<alarm_name>",
    "level": "<severity>",
    "triggeredAt": "<timestamp>",
    "source": "aws-cloudwatch"
  }
}
```

When EventBridge processes this template, it substitutes each placeholder with the actual extracted value. Static strings like `"source": "aws-cloudwatch"` stay exactly as written.

For plain text payloads, you construct a string using the same placeholder mechanism. This is useful when you're sending events to targets that expect raw text—perhaps an HTTP API that wants a form-encoded body, or an SNS topic where you're crafting a human-readable message. For example:

```
Alert: <alarm_name>
Severity: <severity>
Time: <timestamp>
```

One crucial detail: the InputTemplate must be valid JSON or valid plain text before any substitution happens. If you're building a JSON template, EventBridge parses it as JSON to ensure structural correctness. This means you can't use placeholders to inject raw JSON fragments—the placeholders are substituted as strings. If you extract an object or array and try to use it as a placeholder, it will be converted to a string representation, which probably isn't what you want.

There's a workaround: if you need to inject structured data, extract the specific leaf fields instead of the whole object. Rather than extracting `$.detail` as a single variable, extract `$.detail.field1`, `$.detail.field2`, and `$.detail.field3` individually, then reference them in your template. It's a bit more verbose, but it gives you precise control.

### Injecting Static Values and Context

Beyond extracted values, you often need to add static information to your transformed event. Maybe you want to tag all outgoing messages with a fixed routing key, or include a constant that identifies which rule processed the event. You simply include these values directly in your InputTemplate—no extraction needed.

```json
{
  "eventSource": "my-application",
  "version": "1.0",
  "payload": {
    "data": "<extracted_field>",
    "processedAt": "<timestamp>"
  }
}
```

In this example, `eventSource` and `version` are hardcoded, while `extracted_field` and `timestamp` are placeholders that reference extracted values.

You can also reference some built-in context variables that EventBridge provides automatically, without needing to extract them. These include things like the time the rule processed the event, the ARN of the rule, and the AWS account ID. To use them, you reference special placeholder names: `<aws.events.rule-arn>`, `<aws.events.event.ingestion-time>`, and similar. These are powerful for audit trails—you can automatically include the rule that processed an event or the exact timestamp of ingestion without writing any extraction logic.

### Targeting Different AWS Services: Adapting Payloads

Different AWS services have different payload expectations, and a well-designed input transformer adapts your event to match. Let's explore how transformations work across a few common target types.

**Lambda functions** are typically the most flexible targets. They can parse JSON objects, plain text, or even raw strings. If your Lambda expects a specific schema, your InputTemplate simply needs to match that schema. This is often the cleanest transformation scenario because you control both the source (the transformer) and the sink (the Lambda code).

**SQS queues** accept messages as strings. When EventBridge sends a message to SQS using an input transformer, it converts your InputTemplate to a string and sends it as the message body. If your template is JSON, SQS receives a JSON string, which your consumer can parse. If it's plain text, SQS receives plain text. The key insight here is that SQS doesn't care about structure—it's just a message broker—so you have complete freedom in what format you send.

**SNS topics** work similarly to SQS. Your InputTemplate becomes the message body. If you're using SNS subscriptions (like email notifications), you might construct a human-readable plain-text message:

```
AWS Alert Notification

Service: <service_name>
Severity: <severity_level>
Message: <error_description>
Time: <event_time>
Region: <region>
```

**API destinations** are a powerful but detail-oriented target. An API destination represents an HTTP endpoint outside of AWS—perhaps a Slack webhook, PagerDuty API, or your own microservice. The InputTemplate must match whatever that API expects. If you're sending to Slack, you need to construct Slack's message format. If you're calling a REST API, you might build a JSON payload that includes authentication tokens, specific field names, and proper nesting. The flexibility of input transformers shines here—you can reshape your AWS event to match any third-party API contract.

### Real-World Example: CloudWatch Alarm to Slack

Let's walk through a complete, practical example that demonstrates all the pieces working together. Imagine you have a CloudWatch alarm that fires when application errors spike. You want to send a notification to Slack, but the alarm event and Slack's message format are completely mismatched.

A CloudWatch alarm event looks something like this:

```json
{
  "source": "aws.cloudwatch",
  "detail-type": "CloudWatch Alarm State Change",
  "detail": {
    "alarmName": "prod-api-error-rate",
    "state": {
      "value": "ALARM",
      "timestamp": "2024-01-15T14:30:00Z"
    },
    "alarmDescription": "Error rate exceeded 5%",
    "AWSAccountId": "123456789012"
  },
  "region": "us-east-1",
  "time": "2024-01-15T14:30:05Z"
}
```

Slack's incoming webhook API expects a JSON payload with a specific structure, including `channel`, `username`, and `attachments`. Here's how you'd set up the transformation:

**InputPathsMap:**

```json
{
  "alarm_name": "$.detail.alarmName",
  "alarm_state": "$.detail.state.value",
  "alarm_time": "$.detail.state.timestamp",
  "description": "$.detail.alarmDescription",
  "region": "$.region",
  "account": "$.detail.AWSAccountId"
}
```

**InputTemplate:**

```json
{
  "channel": "#aws-alerts",
  "username": "AWS CloudWatch",
  "attachments": [
    {
      "color": "danger",
      "title": "CloudWatch Alarm: <alarm_name>",
      "text": "<description>",
      "fields": [
        {
          "title": "State",
          "value": "<alarm_state>",
          "short": true
        },
        {
          "title": "Region",
          "value": "<region>",
          "short": true
        },
        {
          "title": "Account",
          "value": "<account>",
          "short": true
        },
        {
          "title": "Time",
          "value": "<alarm_time>",
          "short": false
        }
      ]
    }
  ]
}
```

When this rule fires, EventBridge extracts the alarm details, formats them into Slack's expected structure, and sends the message to your webhook. Your team sees a properly formatted Slack notification without needing to write any transformation code. The beauty here is that you're handling the impedance mismatch at the event boundary, not scattered throughout your application code.

### Another Example: Enriching Data for a Third-Party API

Consider a different scenario: you're integrating with a third-party analytics platform that has strict field requirements. Your internal event uses different field names than what the API expects, and you need to add some context that identifies the event source.

Your internal event structure is:

```json
{
  "eventId": "evt-12345",
  "userId": "user-6789",
  "action": "purchase",
  "amount": 99.99,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

The third-party API requires:

```json
{
  "event_id": "...",
  "user_id": "...",
  "event_type": "...",
  "value": "...",
  "occurred_at": "...",
  "source_system": "my-app"
}
```

Notice the naming differences (`userId` vs `user_id`, `amount` vs `value`, `timestamp` vs `occurred_at`) and the requirement to add a static `source_system` field.

**InputPathsMap:**

```json
{
  "event_id": "$.eventId",
  "user_id": "$.userId",
  "action": "$.action",
  "amount": "$.amount",
  "timestamp": "$.timestamp"
}
```

**InputTemplate:**

```json
{
  "event_id": "<event_id>",
  "user_id": "<user_id>",
  "event_type": "<action>",
  "value": "<amount>",
  "occurred_at": "<timestamp>",
  "source_system": "my-app"
}
```

This transformation handles field name mapping, adds the required static value, and delivers exactly what the third-party API expects. You've eliminated an entire layer of translation code that would otherwise live in a Lambda function or API gateway mapping.

### Debugging Transformations with Rule Testing

Building the right transformation requires iteration, and EventBridge provides a testing feature within the AWS Console that makes debugging straightforward. When you're configuring a rule with an input transformer, you can test it before deploying to production.

To test a rule, navigate to the EventBridge Console, find your rule, and look for a "Test" or "Send events" button. You provide a sample event in JSON format—ideally one that matches the structure of events you expect to receive. EventBridge then simulates the rule's behavior: it evaluates the event pattern (if you have one), applies the input transformer, and shows you the resulting payload that would be sent to your targets.

If the output doesn't match what you expected, you can immediately edit the InputPathsMap or InputTemplate and test again. This rapid iteration loop is invaluable when you're working with complex event structures or learning JSONPath syntax.

A practical tip: save example events from your actual source. If you're transforming CloudWatch events, grab a real alarm event from CloudWatch Logs or CloudTrail. Use it as your test input. Real-world events often have nuances—extra fields, unexpected nesting, or inconsistent null handling—that your sample event might miss.

### Common Pitfalls and Troubleshooting

Even with a solid understanding of the model, a few gotchas can trip you up. The most common is forgetting that JSONPath is case-sensitive and that field names with special characters require bracket notation. If you write `$.detail.instance-id` but the actual field is `instance_id` (with an underscore instead of a hyphen), the extraction silently fails and your placeholder gets an empty string.

Another frequent issue is assuming placeholders will inject raw JSON or arrays into your template. Remember: placeholders are substituted as strings. If you extract `$.resources` expecting to inject a whole array into your template, you'll get a string representation of that array, not a usable array structure. Extract the specific fields you need instead.

Also be mindful of null or missing values. If your JSONPath expression targets a field that doesn't exist in a particular event, the placeholder resolves to an empty string. This is usually fine, but it can lead to surprising output if you're not expecting it. If you need more robust handling of missing fields, you might want to ensure your event pattern is specific enough that you only process events with the fields you expect.

Finally, remember that the InputTemplate itself must be valid JSON or valid text before substitution. You can't use a template like `{"data": <extracted_field>}` if `extracted_field` contains a JSON object—it will be converted to a string, breaking your intended structure. Plan your extractions and templates with the final shape in mind.

### When to Use Input Transformers (and When Not To)

Input transformers are powerful for certain scenarios, but they're not a universal solution. Use them when you need to adapt event structure to match target expectations, when you want to add static context or routing information, or when you're eliminating boilerplate transformation code that would otherwise live in your targets.

They work especially well for simple-to-moderate transformations: reshaping JSON, mapping field names, filtering to include only relevant fields, and combining extracted values with static content. If your transformation needs are this straightforward, an input transformer keeps your architecture clean and your targets focused on business logic, not event plumbing.

However, if you need complex conditional logic—"if this field is X, then transform it this way; otherwise, do something else"—input transformers can't help. JSONPath doesn't support conditionals. You'd be better served by pushing that logic into your target (a Lambda function is the typical choice). Similarly, if you need to perform aggregations, call external services, or do any real computation during transformation, a Lambda function with a direct EventBridge invocation is more appropriate.

Input transformers are also less useful when your target is already flexible about input format. A Lambda function that can parse various event structures might not need transformation at all. But as soon as you're repeating the same parsing logic across multiple targets, or you're building transformations that would be cleaner outside application code, input transformers start to shine.

### Conclusion

EventBridge's input transformer feature elegantly solves a common architectural problem: adapting events to match target expectations without embedding transformation logic throughout your system. By internalizing the two-step model—extraction via JSONPath, then assembly via templates—you gain a clean, declarative way to reshape events at the boundary.

The examples in this article show how to handle real scenarios: turning CloudWatch alarms into Slack messages, mapping fields for third-party APIs, and enriching events with context. As you build event-driven architectures, you'll find input transformers invaluable for keeping your targets lean and your event pipeline clear.

The best practice is to test early and often using the EventBridge Console's testing feature, to extract only the fields you actually need, and to keep your templates simple. When you find yourself tempted to add complex conditional logic, that's a signal to reach for a Lambda function instead. Used in the right context, input transformers eliminate boilerplate, clarify your event contract, and let your targets focus on what they do best.
