---
title: "Writing EventBridge Event Patterns: Syntax, Operators, and Examples"
---

# Writing EventBridge Event Patterns: Syntax, Operators, and Examples

EventBridge event patterns are the engine that powers selective event routing in AWS. Without them, you'd either process every single event your infrastructure generates—a path to financial ruin and operational chaos—or you'd build clunky filtering logic into your applications. Instead, EventBridge lets you declare patterns that act as intelligent gatekeepers, deciding which events make it through to your targets.

The challenge is that event patterns use a JSON syntax that differs from typical JSON queries you might be familiar with. The operators are concise but unintuitive at first glance. Combine that with the recursive nature of event matching—patterns can target fields buried several levels deep in the event structure—and you quickly realize that writing robust patterns requires understanding both the syntax and the semantics of how EventBridge evaluates them.

This article walks you through the complete landscape of EventBridge event patterns. We'll explore the operators available to you, understand the event structure you're matching against, and work through progressively complex real-world examples. By the end, you'll be able to write patterns that elegantly express complex filtering logic without resorting to Lambda functions or other post-processing workarounds.

### Understanding the EventBridge Event Structure

Before you can write effective patterns, you need to understand what you're matching against. Every event that flows through EventBridge follows a consistent envelope structure, whether it originated from an AWS service, a third-party SaaS application, or your own custom application.

The envelope contains several top-level fields: `version`, `id`, `detail-type`, `source`, `account`, `time`, `region`, `resources`, and `detail`. The first eight are fixed fields that EventBridge manages. The `detail` field is where the actual content of the event lives—and it's the richest source of information for your patterns.

Think of it this way: the envelope fields are like the metadata on a postal letter (sender, recipient, timestamp), while the detail object is the letter's contents. You can write patterns that match against the envelope metadata alone, but most sophisticated patterns operate on the contents of the detail object.

Here's a concrete example. When EC2 terminates an instance, EventBridge generates an event that looks roughly like this:

```json
{
  "version": "0",
  "id": "6a7e8feb-b491-4cf7-a9f1-bf3703467718",
  "detail-type": "EC2 Instance State-change Notification",
  "source": "aws.ec2",
  "account": "123456789012",
  "time": "2024-01-15T12:34:56Z",
  "region": "us-east-1",
  "resources": ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"],
  "detail": {
    "instance-id": "i-1234567890abcdef0",
    "state": "terminated",
    "state-code": 48
  }
}
```

Your event patterns will match against this structure. Some patterns target the envelope (like matching `source == "aws.ec2"`), while others drill into the detail object (like matching `detail.state == "terminated"`).

### Core Matching Operators

EventBridge provides a set of operators, each expressed as a JSON key, that dictate how matching should behave. Understanding these operators is the foundation of writing effective patterns.

**Exact Matching with Empty Lists**

The simplest operator is also the default behavior: exact matching. You express it by providing a value or a list of values. If you provide a list, the pattern matches if the event's value equals any element in the list.

```json
{
  "source": ["aws.ec2"],
  "detail-type": ["EC2 Instance State-change Notification"]
}
```

This pattern matches any event whose `source` is exactly `"aws.ec2"` AND whose `detail-type` is exactly `"EC2 Instance State-change Notification"`. EventBridge applies AND logic when multiple fields are present and OR logic when multiple values are in the same list.

You can omit the list brackets if you have only one value, though the list syntax is more consistent:

```json
{
  "source": "aws.ec2"
}
```

**Prefix Matching**

The prefix operator lets you match against the beginning of a string. This is invaluable when you want to catch variations of detail-type or other string values without enumerating every possibility.

```json
{
  "detail": {
    "eventName": [{"prefix": "Put"}]
  }
}
```

This pattern matches if the `detail.eventName` field starts with "Put". So it would match "PutObject", "PutBucketPolicy", "PutLifecycleConfiguration", and so on. Note the nested list syntax: the prefix operator is itself wrapped in a list.

**Anything-But Matching**

Sometimes it's easier to express what you don't want than what you do. The anything-but operator inverts the matching logic.

```json
{
  "detail": {
    "state": [{"anything-but": "pending"}]
  }
}
```

This pattern matches any state except "pending". You can provide multiple values in the anything-but array:

```json
{
  "detail": {
    "state": [{"anything-but": ["pending", "running", "stopped"]}]
  }
}
```

Be cautious with anything-but when combined with other conditions. A common mistake is assuming that anything-but alone will filter out all unwanted events, but if the field doesn't exist, anything-but will also match. We'll discuss the exists operator in a moment, which solves this problem.

**Numeric Comparators**

When you're matching numeric values, EventBridge provides a set of comparison operators. These operators accept numbers and compare the event's value against the specified threshold.

```json
{
  "detail": {
    "cpu-usage": [{"numeric": [">", 80]}]
  }
}
```

This pattern matches if `detail.cpu-usage` is greater than 80. The full set of supported comparators includes `<`, `<=`, `>`, `>=`, `=`, and `!=`. You can also chain multiple comparators to express a range:

```json
{
  "detail": {
    "cpu-usage": [{"numeric": [">", 20, "<=", 80]}]
  }
}
```

This matches CPU usage between 20 (exclusive) and 80 (inclusive). When you provide multiple comparators in a single array, they're combined with AND logic.

**Exists Matching**

The exists operator lets you match based on whether a field is present in the event, regardless of its value.

```json
{
  "detail": {
    "error": [{"exists": true}]
  }
}
```

This matches events where the `detail.error` field is present. Set exists to false to match events where the field is absent:

```json
{
  "detail": {
    "error": [{"exists": false}]
  }
}
```

This is particularly useful when combined with anything-but. If you want to exclude "pending" state but only for events where the state field actually exists, you'd write:

```json
{
  "detail": {
    "state": [{"anything-but": "pending"}],
    "state": [{"exists": true}]
  }
}
```

Wait, that's not valid JSON due to the duplicate key. Instead, you need to structure it differently by combining conditions on the same field:

```json
{
  "detail": {
    "state": [{"anything-but": "pending"}, {"exists": true}]
  }
}
```

Actually, let me clarify this more carefully. When you have multiple operators or conditions on the same field, they need to coexist in the same list, and they're combined with AND logic:

```json
{
  "detail": {
    "state": [{"anything-but": "pending"}]
  }
}
```

If you want to ensure the field exists AND it's not pending, you'd need to think about whether anything-but already implies existence. In practice, anything-but will not match if the field is missing, so it implicitly requires existence.

**IP Address Matching**

EventBridge supports CIDR notation for matching IP addresses, which is essential when you need to filter based on source or destination IPs.

```json
{
  "detail": {
    "sourceIPAddress": [{"cidr": "10.0.0.0/8"}]
  }
}
```

This pattern matches if the `detail.sourceIPAddress` falls within the specified CIDR block. You can list multiple CIDR blocks:

```json
{
  "detail": {
    "sourceIPAddress": [{"cidr": ["10.0.0.0/8", "192.168.0.0/16"]}]
  }
}
```

**Wildcard Matching**

AWS introduced the wildcard operator more recently, and it allows you to match patterns using the asterisk (`*`) character, similar to shell globbing.

```json
{
  "detail": {
    "bucket": [{"wildcard": "logs-*"}]
  }
}
```

This pattern matches bucket names like "logs-2024-01-15", "logs-prod", "logs-archive", and so on. The asterisk matches zero or more characters. This is particularly useful for versioned or time-based naming schemes where you want to avoid enumerating every possible value.

### Matching Top-Level Event Envelope Fields

The envelope fields—`source`, `detail-type`, `account`, `region`, and `resources`—are special because they appear at the root level of the event, not nested inside detail. EventBridge treats them distinctly in patterns.

**Source and Detail-Type**

These are the most commonly matched fields. The `source` field identifies which AWS service or custom application generated the event, while `detail-type` describes the kind of event within that source.

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"]
}
```

This pattern catches all S3 object creation events. The source field is especially useful as a top-level filter because it's cheap to match—EventBridge can eliminate entire categories of events without inspecting the detail object.

**Account and Region**

You can filter by AWS account ID and region, which is useful in multi-account or multi-region environments.

```json
{
  "account": ["123456789012"],
  "region": ["us-east-1", "us-west-2"]
}
```

This pattern matches events from a specific account in either of two regions. Remember that the OR logic applies within the list (match either region), while AND logic applies across fields (must be the correct account AND one of the correct regions).

**Resources**

The resources field contains a list of ARNs related to the event. This is a top-level field, but it behaves slightly differently because it's already an array. When you match against resources, you're checking if any element in the resources array matches your pattern.

```json
{
  "resources": ["arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"]
}
```

This matches events where the specified instance ARN appears in the resources list. You can use prefix matching here as well:

```json
{
  "resources": [{"prefix": "arn:aws:ec2:us-east-1"}]
}
```

### Matching Nested Detail Fields

The real power of EventBridge patterns emerges when you start matching against fields nested within the detail object. This is where you express business logic—matching specific error types, resource attributes, or state transitions.

When you reference a field inside detail, you nest it in a "detail" key in your pattern:

```json
{
  "detail": {
    "eventName": ["PutObject"],
    "requestParameters": {
      "bucketName": ["my-bucket"]
    }
  }
}
```

This pattern matches S3 PutObject events for a specific bucket. Notice how you can nest arbitrarily deep to match the actual structure of your events. The operators we discussed earlier—prefix, anything-but, numeric, exists, cidr, wildcard—all work on detail fields exactly as they do on envelope fields.

EventBridge applies AND logic when matching multiple fields: the event must match the eventName condition AND the bucketName condition. If you want OR logic at the same level, you need to structure your rule differently, typically by creating multiple rules or by using multiple values in a single list.

### Practical Examples: From Simple to Complex

Let's ground this in real-world scenarios. I'll build up from simple patterns to more intricate ones, each illustrating different operators and techniques.

**Example 1: Basic Instance Termination Detection**

Suppose you want to be notified whenever an EC2 instance terminates in your account. Here's the pattern:

```json
{
  "source": ["aws.ec2"],
  "detail-type": ["EC2 Instance State-change Notification"],
  "detail": {
    "state": ["terminated"]
  }
}
```

This is straightforward: match events from the EC2 service, specifically state-change notifications, where the new state is terminated. Every time an instance terminates, this pattern will fire, and your target (Lambda, SNS, SQS, whatever you've configured) will receive the event.

**Example 2: S3 Events with Prefix Filtering**

Now let's say you want to process S3 object uploads, but only for files in a specific folder structure. Perhaps you have a bucket where application logs are uploaded to `logs/2024/01/15/`, and you want to process anything in the logs folder:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["my-logging-bucket"]
    },
    "object": {
      "key": [{"prefix": "logs/"}]
    }
  }
}
```

This pattern uses exact matching for the bucket name and prefix matching for the object key. Any file uploaded to my-logging-bucket with a key starting with "logs/" will match. This prevents accidentally processing files uploaded to other prefixes in the same bucket.

**Example 3: Excluding Certain Conditions with Anything-But**

Let's refine the previous example. What if you want to process logs, but you want to ignore test files? Here's how:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["my-logging-bucket"]
    },
    "object": {
      "key": [{"prefix": "logs/"}, {"anything-but": {"prefix": "logs/test/"}}]
    }
  }
}
```

Wait, let's parse this carefully. You're listing two conditions in the object.key array, separated by commas. In EventBridge patterns, when you have multiple conditions in an array like this, they're combined with AND logic. So this matches keys that start with "logs/" AND do NOT start with "logs/test/". This is a powerful technique for expressing "match this pattern except for these cases."

**Example 4: Numeric Range Matching for Alarms**

Imagine you're consuming custom metrics from CloudWatch and want to trigger actions when CPU usage is in a specific range—high enough to be concerning but low enough that it's not a critical emergency:

```json
{
  "source": ["custom.metrics"],
  "detail-type": ["CPU Alert"],
  "detail": {
    "cpu-usage": [{"numeric": [">", 70, "<=", 90]}]
  }
}
```

This pattern matches events where CPU usage is greater than 70% and less than or equal to 90%. You could extend this to match multiple ranges for different severity levels, perhaps creating separate rules for different thresholds.

**Example 5: Wildcard Pattern for Versioned Resources**

Suppose your organization uses a naming convention where S3 buckets are named `data-prod-v1`, `data-prod-v2`, `data-prod-v3`, and you want to match all production data buckets without enumerating each one:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": [{"wildcard": "data-prod-v*"}]
    }
  }
}
```

The wildcard operator handles the version suffix elegantly. This is much cleaner than writing separate rules for each version or hardcoding version numbers.

**Example 6: Complex Multi-Condition Pattern**

Let's build something more realistic: match CloudTrail events for IAM policy changes, but only in specific accounts and regions, and exclude read-only operations:

```json
{
  "source": ["aws.cloudtrail"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "account": ["123456789012", "210987654321"],
  "region": ["us-east-1", "eu-west-1"],
  "detail": {
    "eventSource": ["iam.amazonaws.com"],
    "eventName": [{"prefix": "Put"}, {"prefix": "Create"}, {"prefix": "Delete"}],
    "readOnly": [{"anything-but": true}]
  }
}
```

This pattern does a lot: it targets CloudTrail events from two specific AWS accounts in two specific regions. Within those accounts and regions, it looks for IAM API calls where the operation name starts with Put, Create, or Delete (using OR logic via the list), and where readOnly is not true. This effectively catches mutations to IAM policies while ignoring read operations.

**Example 7: IP Address Filtering for VPC Flow Logs**

When analyzing VPC Flow Logs, you might want to trigger alerts only for traffic originating from specific IP ranges—perhaps external traffic from known partners or detected threats:

```json
{
  "source": ["aws.vpc"],
  "detail-type": ["VPC Flow Log"],
  "detail": {
    "srcip": [{"cidr": "203.0.113.0/24"}],
    "dstport": [{"numeric": [">=", 443, "<=", 8443]}]
  }
}
```

This pattern matches VPC flow log entries where the source IP is within the specified CIDR block and the destination port is in the HTTPS range. Combined with a rule that checks for denied packets, you could build an early warning system for suspicious traffic.

### Common Pitfalls and How to Avoid Them

Even experienced developers stumble when writing EventBridge patterns. Let's walk through the most frequent mistakes and how to sidestep them.

**Confusing AND and OR Logic**

The most frequent mistake is forgetting how AND and OR are applied. Within a single list, the values are combined with OR. Across fields, they're combined with AND. This pattern matches events where source is "aws.s3" OR source is "aws.lambda", but also requires the detail-type to be "Object Created":

```json
{
  "source": ["aws.s3", "aws.lambda"],
  "detail-type": ["Object Created"]
}
```

If you want events from S3 with detail-type "Object Created" OR events from Lambda with any detail-type, you need separate rules. EventBridge patterns don't support nested OR logic across fields—that's a limitation worth understanding.

**Assuming Anything-But Implies Existence**

The anything-but operator matches events where the field exists and doesn't equal the specified value. If the field is missing entirely, anything-but will still match. If you need to ensure a field exists, use the exists operator explicitly:

```json
{
  "detail": {
    "error": [{"anything-but": "None"}],
    "error": [{"exists": true}]
  }
}
```

Actually, as I mentioned earlier, you can't have duplicate keys in JSON. The correct approach is to ensure that your event data structure always includes the field, or use a single rule that checks both conditions implicitly. If you need strict existence checking combined with value filtering, you might need to handle it in your target (Lambda function) rather than in the pattern.

**Mismatched Data Types**

EventBridge attempts type coercion, but it's not magic. If you're using the numeric operator on a string field, the match might fail silently. Always verify the actual data type in your events. Use the CloudWatch Logs insights query or manual event inspection to confirm what types you're dealing with.

**Nested Structure Mismatch**

This is subtle: if your event's detail object has a nested structure like `requestParameters.bucketName`, but you write a pattern assuming it's `bucketName` directly in detail, your pattern will fail to match. Always inspect real events from your event source to understand the exact structure.

**Over-Matching and Under-Matching**

It's easy to write a pattern that's either too strict (matches nothing) or too loose (matches everything). The best practice is to test your patterns against actual events. Most AWS services have sample events in their documentation, and you can use the EventBridge rule testing feature in the console to validate patterns before deploying.

### Testing Your Patterns

EventBridge provides a built-in testing tool in the AWS Console. When you're creating or editing a rule, you can supply a sample event and see whether it matches your pattern. This is invaluable for catching mistakes before your pattern goes into production.

To test a pattern, navigate to your EventBridge rule, click "Edit", and look for the "Test event pattern" section. Paste in a JSON event that resembles what you expect to receive, and EventBridge will immediately tell you whether it matches. Iterate on your pattern until you see the desired behavior.

In practice, I recommend creating a small test suite of representative events—both events that should match and events that shouldn't—and validating your pattern against all of them. This discipline saves debugging time later.

### Advanced Pattern Design Strategies

As you become more comfortable with EventBridge patterns, consider these strategies for building robust filtering systems.

**Layered Filtering**

Start with cheap filters (source, region, account) and progress to expensive ones (deep detail inspection). EventBridge optimizes rule evaluation, so this layering might not always make a performance difference, but it makes your patterns more readable and maintainable.

**Negative Patterns with Multiple Rules**

If you find yourself writing complex anything-but conditions, consider splitting into multiple rules. One rule matches the events you want, and another matches and discards events you don't. This is clearer to reason about and easier to modify later.

**Document Your Business Logic**

EventBridge patterns are technically JSON, but they encode business logic. Add comments or documentation explaining why each condition exists. A rule that filters by account and region seems straightforward, but future maintainers will appreciate knowing whether it's for security, compliance, or cost allocation.

### Conclusion

EventBridge event patterns are a powerful, declarative way to route events through your AWS infrastructure. They're more expressive than they initially appear, supporting exact matching, prefix patterns, numeric comparisons, IP address filtering, and wildcard matching, all combined with precise AND/OR logic.

The key to mastering patterns is understanding the event structure you're matching against, internalizing the semantics of each operator, and practicing with real events. Start simple—match on source and detail-type—and progressively add more sophisticated conditions. Use the testing tools available in the console. When you encounter a pattern that seems too complex, step back and consider whether multiple simpler rules might be clearer.

As you build more event-driven systems on AWS, you'll find that well-designed event patterns eliminate vast amounts of filtering logic from your applications. They're a small part of EventBridge's architecture, but they're absolutely foundational to making event-driven designs practical and maintainable.
