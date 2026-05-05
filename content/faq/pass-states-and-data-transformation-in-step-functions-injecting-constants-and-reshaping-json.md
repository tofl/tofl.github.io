---
title: "Pass States and Data Transformation in Step Functions: Injecting Constants and Reshaping JSON"
---

## Pass States and Data Transformation in Step Functions: Injecting Constants and Reshaping JSON

When you first start building AWS Step Functions workflows, it's tempting to treat the state machine as merely a orchestrator—a simple conductor that calls Lambda, SQS, DynamoDB, and other services in sequence. But there's a hidden superpower lurking in the Step Functions specification that many developers overlook: the Pass state. It's deceptively simple on the surface, yet incredibly flexible when you understand how to wield it.

The Pass state does exactly what its name suggests—it passes data through your workflow without calling any external service. No Lambda invocation, no API gateway hit, no database query. Yet within that "pass-through," you can transform data, inject constants, reshape JSON structures, validate inputs, and fork your execution based on logical conditions. Master the Pass state, and your Step Functions workflows become leaner, cheaper, and far more maintainable.

### Understanding the Pass State Fundamentals

At its core, a Pass state is a no-op state that takes input and produces output. The magic lies in the four properties that control how data flows through it: InputPath, Parameters, ResultPath, and OutputPath. These properties form a data transformation pipeline that occurs entirely within the state machine, without leaving your workflow.

Let's establish the mental model. Every state in Step Functions receives input (the data passed to it from the previous state or initial execution input), and every state produces output (the data it passes to the next state). The InputPath, Parameters, ResultPath, and OutputPath properties let you intercept and reshape that data at each step.

Think of it like a factory assembly line. InputPath is your selection mechanism—you choose which parts of the incoming data matter to you. Parameters lets you transform and enrich that selected data. ResultPath tells you where to put the result in relation to the original input. And OutputPath is your final filter—you decide what actually leaves the state.

### InputPath: Selecting What Matters

InputPath is your first checkpoint. It uses a JSONPath expression to select which parts of the input you want to work with. By default, InputPath is `$`, meaning "take the entire input as-is." But you can be more surgical.

Consider a scenario where your Step Functions execution receives a large payload with customer data:

```json
{
  "customerId": "12345",
  "firstName": "Alice",
  "lastName": "Smith",
  "accountDetails": {
    "tier": "premium",
    "balance": 5000
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00Z",
    "source": "web"
  }
}
```

If you only care about the accountDetails for the next step, you could set InputPath to `$.accountDetails`. The Pass state would then work only with:

```json
{
  "tier": "premium",
  "balance": 5000
}
```

This isn't just about filtering for readability—it's about controlling the scope of what you're transforming and what you're passing forward. A restrictive InputPath can simplify your transformation logic downstream.

### Parameters: The Power of Data Reshaping

Parameters is where the real transformation magic happens. While InputPath selects which data to work with, Parameters lets you reshape, reorganize, and enrich that data. You can use static values, reference input fields using JSONPath, combine multiple fields, and even perform string interpolation.

Imagine you need to normalize an incoming order format before processing it. The system sends you orders like this:

```json
{
  "orderId": "ORD-2024-001",
  "items": [
    {
      "sku": "WIDGET-A",
      "quantity": 3
    }
  ],
  "customerEmail": "alice@example.com"
}
```

But your internal processing pipeline expects a different structure with specific metadata injected. You could use Parameters to reshape it:

```json
"Parameters": {
  "order_id.$": "$.orderId",
  "items.$": "$.items",
  "customer_email.$": "$.customerEmail",
  "processed_at.$": "$$.State.EnteredTime",
  "environment": "production",
  "version": "2.0"
}
```

Notice the syntax carefully. Fields with `.$` at the end use JSONPath expressions to reference the input. Fields without `.$` are treated as literal values. The `$$.State.EnteredTime` is a special context object that gives you access to state machine metadata like when the state was entered.

After this Pass state executes, your output would be:

```json
{
  "order_id": "ORD-2024-001",
  "items": [
    {
      "sku": "WIDGET-A",
      "quantity": 3
    }
  ],
  "customer_email": "alice@example.com",
  "processed_at": "2024-01-15T10:30:00.000Z",
  "environment": "production",
  "version": "2.0"
}
```

This is incredibly useful for normalization. You're standardizing the shape of data as it moves through your workflow, making downstream states simpler and more predictable. You're also injecting metadata and constants that your later states need.

### Result: Injecting Fixed Values Without Input

Sometimes you don't want to transform incoming data at all—you want to inject a completely new object or a fixed value. This is where the Result property shines. When you use Result, you're providing a static value that becomes the output of the Pass state (unless modified by ResultPath and OutputPath).

For example, imagine you need to initialize a processing context early in your workflow:

```json
{
  "Type": "Pass",
  "Result": {
    "processingId": "PROC-2024-001",
    "retryCount": 0,
    "status": "initialized",
    "tags": ["priority-high", "customer-tier-premium"]
  },
  "ResultPath": "$",
  "Next": "ValidateInput"
}
```

This Pass state ignores any incoming input and produces the exact Result object you specified. It's useful when you need to set up a baseline data structure that subsequent states will enhance.

### ResultPath: Where Does the Result Go?

ResultPath controls how the Result (or the transformed output from Parameters) combines with the original input. This is subtle but powerful, and it's where many developers get confused.

ResultPath has three common patterns:

**ResultPath: `$`** replaces the entire input with the Result. This is useful when you're doing a complete transformation and you don't need the original input anymore.

**ResultPath: `$.fieldName`** puts the Result into a specific field of the original input. The original input structure is preserved, and the Result is nested inside it. This is perfect when you want to enrich the original data without losing it.

**ResultPath: `null`** discards the Result entirely and passes the original input untouched to the next state. This is useful when you're doing a Pass state purely for conditional logic or side effects (though technically a Pass state can't have side effects—but you see the pattern).

Let's illustrate with a concrete example. You have incoming customer data:

```json
{
  "customerId": "12345",
  "email": "alice@example.com"
}
```

And you have a Pass state that creates enrichment data:

```json
{
  "Type": "Pass",
  "Parameters": {
    "enrichment_timestamp": "2024-01-15T10:30:00Z",
    "data_version": "v2"
  },
  "ResultPath": "$.enrichment",
  "Next": "ProcessOrder"
}
```

With ResultPath set to `$.enrichment`, the output becomes:

```json
{
  "customerId": "12345",
  "email": "alice@example.com",
  "enrichment": {
    "enrichment_timestamp": "2024-01-15T10:30:00Z",
    "data_version": "v2"
  }
}
```

The original customer data is preserved, and the enrichment data is nested inside. This is commonly used when you want to add metadata or computed values without losing the original payload.

If you had used `ResultPath: "$"` instead, you'd lose the original customer data entirely and only have the enrichment object.

### OutputPath: The Final Filter

After InputPath, Parameters, ResultPath, and Result have all done their work, OutputPath is your final opportunity to filter what actually passes to the next state. It's another JSONPath expression that selects which parts of the current state's output you want to forward.

OutputPath defaults to `$`, meaning "pass everything along." But you can use it to clean up your payload before it moves to the next state.

Building on our earlier example, if you had enriched data like this:

```json
{
  "customerId": "12345",
  "email": "alice@example.com",
  "enrichment": {
    "enrichment_timestamp": "2024-01-15T10:30:00Z",
    "data_version": "v2"
  },
  "internal_debug_info": "some debug data"
}
```

And you didn't want internal_debug_info to leak to the next state, you could set OutputPath to:

```json
"OutputPath": "$..[?(@.internal_debug_info != true)]"
```

Or more simply, if you only want specific fields, you could construct them:

```json
{
  "Type": "Pass",
  "OutputPath": "{ \"customerId\": $.customerId, \"email\": $.email, \"enrichment\": $.enrichment }"
}
```

Actually, that syntax isn't quite right in JSONPath. Let me correct that—OutputPath is a path expression, not a constructor. If you want to be more surgical, you'd typically use a Parameters with the desired output and then set OutputPath to `$`.

The practical point: OutputPath is your gateway control. Use it to ensure downstream states only receive the data they need, preventing information leakage and keeping your workflow focused.

### Real-World Example: Normalizing Multi-Format Input

Let's build a realistic example that ties all these concepts together. Imagine you're building a payment processing workflow that accepts orders from multiple sources—your web API, a mobile app, and partner integrations. Each source sends slightly different data structures.

Your web API sends:

```json
{
  "order_id": "WEB-001",
  "customer": {
    "name": "Alice Smith",
    "email": "alice@example.com"
  },
  "amount": 99.99,
  "currency": "USD"
}
```

Your mobile app sends:

```json
{
  "id": "MOB-001",
  "user": {
    "fullName": "Bob Jones",
    "contactEmail": "bob@example.com"
  },
  "total": 49.99,
  "currencyCode": "USD"
}
```

You want to normalize both formats into a canonical structure before processing. Here's your Pass state:

```json
{
  "Type": "Pass",
  "InputPath": "$",
  "Parameters": {
    "orderId.$": "$.order_id || $.id",
    "customerName.$": "$.customer.name || $.user.fullName",
    "customerEmail.$": "$.customer.email || $.user.contactEmail",
    "amount.$": "$.amount || $.total",
    "currency.$": "$.currency || $.currencyCode",
    "normalizedAt.$": "$$.State.EnteredTime",
    "source": "unknown"
  },
  "ResultPath": "$",
  "OutputPath": "$",
  "Next": "ValidateOrder"
}
```

Wait—I should clarify. The JSONPath syntax `||` for logical OR doesn't actually work in Step Functions. Let me revise. In Step Functions, you'd need to handle this differently, typically with a Lambda function or multiple Pass states with Choices. But the principle stands—you're normalizing data shapes.

A more realistic approach would be a single Pass state that handles one specific format, paired with branching logic earlier in your workflow to route different source formats to different normalization states. Or you could use a Lambda function for complex logic like this.

Let me give you a more practical example: normalizing the order after it's already been parsed into a consistent format, just with inconsistent field names:

```json
{
  "orderId": "ORD-001",
  "amount": "99.99",
  "customer_id": "CUST-123",
  "created_timestamp": "2024-01-15T10:30:00Z"
}
```

Your Pass state normalizes it to your internal schema:

```json
{
  "Type": "Pass",
  "Parameters": {
    "order_id.$": "$.orderId",
    "total_amount.$": "States.StringToNumber($.amount)",
    "customer_id.$": "$.customer_id",
    "created_at.$": "$.created_timestamp",
    "processed_at.$": "$$.State.EnteredTime",
    "status": "pending",
    "retry_count": 0
  },
  "ResultPath": "$",
  "Next": "ValidateOrder"
}
```

Note the use of `States.StringToNumber()`, which is one of the intrinsic functions Step Functions provides for common transformations within the state machine itself.

The output is now in a consistent format:

```json
{
  "order_id": "ORD-001",
  "total_amount": 99.99,
  "customer_id": "CUST-123",
  "created_at": "2024-01-15T10:30:00Z",
  "processed_at": "2024-01-15T10:35:00Z",
  "status": "pending",
  "retry_count": 0
}
```

### Adding Metadata and Enrichment with Pass States

Another powerful pattern is using Pass states to inject metadata that your workflow will reference later. This includes timestamps, execution context, processing flags, and versioning information.

Consider a data processing pipeline where you want to track provenance—where each piece of data came from, when it was processed, and which system processed it:

```json
{
  "Type": "Pass",
  "Parameters": {
    "payload.$": "$",
    "metadata": {
      "processed_by": "order-ingestion-v2.1",
      "environment": "production",
      "region": "us-east-1"
    },
    "timestamps": {
      "received.$": "$$.State.EnteredTime",
      "processing_started.$": "$$.State.EnteredTime"
    },
    "processing_state": {
      "step": "normalize",
      "retry_count": 0,
      "error_count": 0
    }
  },
  "ResultPath": "$",
  "Next": "ProcessPayload"
}
```

Now every subsequent state in your workflow has access to this metadata without having to compute it. The original payload is nested, and you've added context information that helps with observability, debugging, and decision-making.

### Reshaping Data for Branching Workflows

Pass states excel at reshaping data before your workflow branches into different paths. Imagine you're processing transactions and need to route them to different handlers based on amount. You want to ensure each branch receives exactly the data it needs in the format it expects.

Before branching:

```json
{
  "Type": "Pass",
  "InputPath": "$",
  "Parameters": {
    "transaction_id.$": "$.id",
    "amount_cents.$": "States.MathAdd(States.StringToNumber($.amount) * 100, 0)",
    "merchant_id.$": "$.merchant",
    "processed": false
  },
  "ResultPath": "$",
  "Next": "RouteByAmount"
}
```

Then your Choice state routes to different Lambda functions:

```json
{
  "Type": "Choice",
  "Choices": [
    {
      "Variable": "$.amount_cents",
      "NumericGreaterThan": 50000,
      "Next": "ProcessLargeTransaction"
    },
    {
      "Variable": "$.amount_cents",
      "NumericGreaterThan": 1000,
      "Next": "ProcessNormalTransaction"
    }
  ],
  "Default": "ProcessSmallTransaction"
}
```

Each branch receives the same normalized data structure, making your downstream states simpler and less error-prone.

### Using Pass States for Data Validation

While Pass states can't directly validate in the sense of throwing errors for invalid data, you can use them in conjunction with Choice states to implement validation logic. The Pass state prepares the data and flags issues, and the Choice state branches based on those flags.

```json
{
  "Type": "Pass",
  "Parameters": {
    "data.$": "$",
    "validation": {
      "has_order_id.$": "$.orderId != null",
      "has_customer.$": "$.customer != null",
      "amount_positive.$": "$.amount > 0"
    }
  },
  "ResultPath": "$",
  "Next": "ValidateData"
}
```

Then a Choice state can branch:

```json
{
  "Type": "Choice",
  "Choices": [
    {
      "Variable": "$.validation.has_order_id",
      "BooleanEquals": true,
      "Variable": "$.validation.has_customer",
      "BooleanEquals": true,
      "Variable": "$.validation.amount_positive",
      "BooleanEquals": true,
      "Next": "ProcessOrder"
    }
  ],
  "Default": "HandleValidationError"
}
```

In practice, you might use a Catch block on a subsequent Lambda call to handle actual validation, but the Pass state can definitely prepare metadata that aids in validation decisions.

### Handling Null Results and Error Paths

A subtle but important scenario: what if your transformation results in null or an empty object? Step Functions handles this gracefully. The Pass state will output the result as-is, even if it's null, unless you've explicitly constrained it with OutputPath.

This can be useful for implementing optional transformations. If a field doesn't exist, you might set a default:

```json
{
  "Type": "Pass",
  "Parameters": {
    "customerId.$": "$.customerId",
    "tier.$": "$.accountTier || 'standard'",
    "notificationEnabled.$": "$.preferences.notifications || false"
  },
  "ResultPath": "$",
  "Next": "ProcessCustomer"
}
```

The `||` syntax for defaults actually works in Step Functions' Data Flow Simulator, but in real JSONPath expressions, you'd need to rely on the fact that missing fields default to null, and then handle that in your Choice logic or downstream Lambda.

### Intrinsic Functions for Advanced Transformations

Step Functions provides a set of intrinsic functions you can use within Pass state Parameters to perform calculations and transformations without calling a service. These include:

States.Array() creates an array from individual values, useful for collecting scattered data points into a single list. States.Format() performs string interpolation, which is invaluable for constructing messages or identifiers. States.JsonMerge() combines multiple JSON objects, perfect for merging enrichment data. States.StringToNumber() and States.MathAdd() handle numeric operations. States.Base64Encode() and States.Base64Decode() for encoding. And States.UUID() generates unique identifiers.

A practical example using several of these:

```json
{
  "Type": "Pass",
  "Parameters": {
    "request_id.$": "States.UUID()",
    "message.$": "States.Format('Processing order {} for customer {}', $.orderId, $.customerId)",
    "tags.$": "States.Array($.category, $.priority, 'processed')",
    "metadata.$": "States.JsonMerge($.existingMetadata, { 'version': '2.0', 'timestamp': $$.State.EnteredTime })",
    "numeric_value.$": "States.MathAdd(States.StringToNumber($.baseAmount), 100)"
  },
  "ResultPath": "$",
  "Next": "NextState"
}
```

These functions help you avoid Lambda calls for simple transformations, keeping your workflow lean and execution time down.

### Common Pitfalls and Best Practices

One frequent mistake is overcomplicating Pass states. They're powerful, but they're not meant to replace Lambda functions for complex business logic. If you find yourself building deeply nested conditionals or complex transformations, you're probably better off with a Lambda.

Another pitfall is losing track of your data structure as it flows through multiple Pass states. If you chain three Pass states that each reshape the data differently, it becomes hard to reason about what structure a downstream Lambda expects. Document your data schema at key points in your workflow, and consider using consistent field naming conventions.

Be cautious with ResultPath and OutputPath. The difference between `$`, `$.field`, and `null` is subtle but consequential. Test your state machine in the Step Functions console, use the visual debugger, and carefully trace how data flows through your workflow.

When using Parameters to construct complex nested structures, remember that you're not writing general-purpose code—you're writing JSONPath expressions. The syntax is terse and has limitations. When in doubt, prefer simplicity.

### Performance and Cost Implications

Here's a benefit that doesn't always get mentioned: Pass states are free. They don't consume Lambda invocations, API calls, or service charges. Building workflows that use Pass states for transformation instead of Lambda functions reduces your AWS costs and improves execution speed. A workflow that might take 30 seconds across multiple Lambda calls could execute in milliseconds with Pass states handling the transformations.

This doesn't mean you should replace all your Lambdas with Pass states—Lambdas are essential for actual business logic. But for data transformation, normalization, and metadata injection, Pass states are your friend.

### Combining Pass States with Other State Types

In real workflows, Pass states rarely work in isolation. They're typically combined with other state types to create sophisticated pipelines. A common pattern is Pass → Lambda → Choice → Pass, where you normalize input, process it, make a decision based on the result, and then reshape the output for the next step.

Another pattern is using Pass states to create "intermediate" outputs in parallel workflows. If you have a Parallel state with multiple branches, you might use Pass states before and after to distribute the input and collect the outputs.

### Conclusion

The Pass state is one of Step Functions' most underrated features. It gives you a powerful, cost-free mechanism to reshape, normalize, and enrich data as it flows through your workflow. By mastering InputPath, Parameters, ResultPath, OutputPath, and the Result field, you gain fine-grained control over data transformation without leaving your state machine.

In practice, effective use of Pass states makes your Step Functions workflows simpler, faster, and cheaper. They're the glue that binds your services together, ensuring that data flows in the format each service expects. They inject metadata that powers observability and branching logic. They normalize multi-source input into canonical formats.

As you build more complex workflows, you'll find yourself reaching for Pass states again and again. Start simple—use them for basic field renaming and metadata injection. As you grow more comfortable, explore how they enable advanced patterns like dynamic branching based on computed values, efficient error handling through data flagging, and seamless integration between services with different schemas.

The next time you're designing a Step Functions workflow, resist the temptation to make everything a Lambda call. Think about what data transformation and enrichment could happen for free in a Pass state instead. Your execution times and AWS bill will thank you.
