---
title: "Understanding State Machine Input and Output Processing in Step Functions"
---

# Understanding State Machine Input and Output Processing in Step Functions

When you first encounter AWS Step Functions, the state machine feels intuitive—define states, connect them with transitions, and let AWS orchestrate your workflow. But there's a layer of complexity that catches many developers off guard: the mechanics of how data flows through your state machine. Understanding how JSON input transforms as it passes from state to state is crucial for building reliable, predictable workflows.

The four fields that govern this flow—InputPath, Parameters, ResultPath, and OutputPath—form the backbone of state machine data processing. Miss the nuances here, and you'll spend hours debugging why your workflow output doesn't match expectations, why results vanish mysteriously, or why downstream states receive malformed data. Master them, and you gain precise control over what data moves through your machine at each step.

This guide walks you through these concepts with clear examples, real-world scenarios, and the mental models you need to predict exactly how data will be transformed at every stage.

### The Data Processing Pipeline: A Mental Model

Before diving into individual fields, let's establish the big picture. Every state processes data in a consistent sequence:

1. **Input arrives** at the state (either from the previous state's output or from the initial input if this is the first state).
2. **InputPath filters or transforms** that input, selecting which parts of the JSON the state actually cares about.
3. **Parameters prepare the payload** to send to the state's task (like a Lambda function or DynamoDB call). This is where you can combine original input with variables, construct new JSON structures, or pass literal values.
4. **The state executes** and produces a result.
5. **ResultPath determines where** that result goes—does it replace the entire input, merge with it, or get discarded?
6. **OutputPath filters the combined state output**, deciding what leaves the state and flows to the next one.

Think of it like a data pipeline at a factory. InputPath is your quality control inspector deciding which products enter the assembly line. Parameters set up the assembly configuration. The task does the work. ResultPath decides where the finished product goes (into a new crate, merged with existing materials, or set aside). OutputPath determines which items ship to the next factory station.

### InputPath: Selecting What Matters

InputPath extracts a portion of the incoming JSON, passing only that subset to the Parameters field and onward to the state's task. By default, InputPath is `$`, which means "the entire input." But you can be selective.

Imagine a state receives this JSON from a previous state:

```json
{
  "userId": "user-123",
  "userName": "alice",
  "orderDetails": {
    "orderId": "order-456",
    "total": 99.99,
    "items": [
      {"sku": "WIDGET-1", "qty": 2},
      {"sku": "GADGET-5", "qty": 1}
    ]
  },
  "metadata": {
    "timestamp": "2024-01-15T10:30:00Z",
    "source": "web"
  }
}
```

If your state only cares about the order details, you might set `InputPath` to `$.orderDetails`. Now, the state receives only:

```json
{
  "orderId": "order-456",
  "total": 99.99,
  "items": [
    {"sku": "WIDGET-1", "qty": 2},
    {"sku": "GADGET-5", "qty": 1}
  ]
}
```

This is cleaner, smaller, and reduces the chance of naming conflicts when you pass data to your task. If you wanted to be even more specific, `InputPath: $.orderDetails.items` would give you just the items array, though in that case your state's task would need to expect an array rather than an object.

You can also use `InputPath: null` to pass no input to the Parameters field. This is useful when your state doesn't actually need any input data—perhaps it's invoking a Lambda with hardcoded parameters, or publishing a static message.

A crucial detail: InputPath applies *before* Parameters. This matters because Parameters can reference variables from the InputPath result, but not from anything filtered out. More on that in the next section.

### Parameters: Constructing the Task Input

Parameters is where you shape the exact JSON that gets sent to your state's task. It's incredibly powerful because it lets you:

- Select specific fields from the input
- Add new fields with static values
- Rename fields
- Combine data from multiple places in the input
- Pass intrinsic functions and context object values

Let's expand our example. Suppose your state is invoking a Lambda function to process an order. The Lambda expects a specific JSON structure, but your input has extra fields the Lambda doesn't need. You could use Parameters to reshape:

```json
{
  "Parameters": {
    "orderId.$": "$.orderId",
    "amount.$": "$.total",
    "itemCount.$": "$.items | length(@)"
  }
}
```

The `.$` suffix in JSON Path syntax tells Step Functions to interpret the value as a JSONPath expression rather than a literal string. So `"orderId.$": "$.orderId"` means "set the field orderId to whatever is at $.orderId in the input."

The result sent to your Lambda task would be:

```json
{
  "orderId": "order-456",
  "amount": 99.99,
  "itemCount": 2
}
```

Clean and focused. You can also mix literal values with dynamic ones:

```json
{
  "Parameters": {
    "orderId.$": "$.orderId",
    "amount.$": "$.total",
    "priority": "high",
    "environment": "production",
    "timestamp.$": "$$.State.EnteredTime"
  ]
}
```

Here, `priority` and `environment` are literal strings, while `orderId` and `amount` come from the input, and `timestamp` comes from the context object (indicated by `$$`). The Lambda receives all of these in a single JSON object.

If you don't define Parameters, Step Functions uses the entire InputPath result as-is. In many simple cases, InputPath and Parameters together handle all your data shape-shifting needs before the task runs.

### ResultPath: Where Does the Result Go?

This is where many developers stumble. The task completes, you get a result, and now you need to decide what happens to it. ResultPath controls that decision, and it has three main behaviors:

**ResultPath: "$"** (the default) replaces the entire state input with the task result. Suppose your Lambda returns:

```json
{
  "success": true,
  "processedOrderId": "order-456",
  "processingTime": 245
}
```

With `ResultPath: "$"`, that entire object becomes the new state output, discarding the original input entirely. The orderId, total, and items that were in the original input are gone.

This is often *not* what you want. It's a common source of bugs where you later try to reference a field that was in the original input but has been replaced.

**ResultPath: "$.fieldName"** merges the result into the state input at the specified path. If you use `ResultPath: "$.processingResult"` with the same Lambda response, the state output becomes:

```json
{
  "orderId": "order-456",
  "total": 99.99,
  "items": [...],
  "metadata": {...},
  "processingResult": {
    "success": true,
    "processedOrderId": "order-456",
    "processingTime": 245
  }
}
```

Now you have both the original input *and* the result. This is often the safer choice because downstream states can access both the original data and the processing result.

**ResultPath: null** discards the result entirely. The state output is the same as the state input. This is useful when a task has side effects (like sending an email) but produces no meaningful return value that you care about. Using null keeps the data flow clean by not accumulating unneeded results.

A practical scenario: you have an order workflow. State A enriches the order with customer details. State B processes payment and returns a transaction ID. You want State C to have access to the original order details *and* the transaction ID.

```json
{
  "States": {
    "EnrichOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:region:account:function:enrich-order",
      "ResultPath": "$.enrichment",
      "Next": "ProcessPayment"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:region:account:function:process-payment",
      "ResultPath": "$.paymentResult",
      "Next": "FinalizeOrder"
    },
    "FinalizeOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:region:account:function:finalize",
      "End": true
    }
  }
}
```

By using specific ResultPath values for each task, FinalizeOrder receives all the accumulated data: the original order input, the enrichment result, and the payment result, all nested under different keys.

### OutputPath: Filtering the Final State Output

OutputPath is the last stop. It determines what data actually leaves the state and flows to the next state. Like InputPath, it uses JSONPath, and it defaults to `$` (everything).

In the scenario above, after ProcessPayment completes, the state has accumulated quite a bit of data:

```json
{
  "userId": "user-123",
  "userName": "alice",
  "orderDetails": {...},
  "metadata": {...},
  "enrichment": {...},
  "paymentResult": {
    "transactionId": "txn-789",
    "authCode": "AUTH123"
  }
}
```

If FinalizeOrder only needs the transaction ID and order details, you could use `OutputPath: "$.paymentResult.transactionId"` to send only that to the next state. Or, if you want multiple fields, you'd need to structure it with Parameters in the FinalizeOrder state itself.

Actually, let me clarify: OutputPath on a state filters what *that state* passes to the next state. It doesn't reshape data; it just selects which parts go forward. So if FinalizeOrder needs both the transaction ID and the order details, and they're at different paths, you'd typically handle that in FinalizeOrder's Parameters or by using a Pass state to restructure.

Here's a practical use case: a notification state that sends an email. The workflow has accumulated a lot of internal data—database query results, cache lookups, etc.—but the next state only needs the customer email and order number. You can use OutputPath to strip everything else away:

```json
{
  "NotifyCustomer": {
    "Type": "Task",
    "Resource": "arn:aws:sns:topic",
    "Parameters": {
      "Message.$": "$.customerEmail",
      "Subject": "Order Confirmation"
    },
    "OutputPath": "$.orderId",
    "Next": "LogCompletion"
  }
}
```

OutputPath: "$.orderId" means LogCompletion receives only the order ID, not all the accumulated state data.

### The Processing Order: Putting It All Together

To truly master state machine data flow, you need to internalize the exact order of operations. Let's trace a concrete example all the way through.

State receives input:

```json
{
  "customerId": "cust-001",
  "items": ["A", "B"],
  "originalAmount": 100,
  "metadata": {"source": "mobile"}
}
```

State definition:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:region:account:function:calculate-discount",
  "InputPath": "$.items",
  "Parameters": {
    "itemList.$": "$",
    "customerId.$": "$.customerId",
    "requestId.$": "$$.Execution.Id"
  },
  "ResultPath": "$.discount",
  "OutputPath": "$",
  "Next": "NextState"
}
```

Let's trace through:

1. **InputPath** is evaluated first. InputPath: "$.items" extracts just the items array, so the intermediate result is ["A", "B"].

2. **Parameters** is evaluated against the InputPath result. But wait—notice the Parameters references `$.customerId`, which isn't in ["A", "B"]. This will fail or produce null! Here's the gotcha: Parameters can't access data filtered out by InputPath. This is a common mistake.

The correct state would need either:
- Remove the InputPath (use the default `$`), or
- Include customerId in the InputPath, or
- Pass customerId through a different mechanism

Let's assume the corrected state:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:region:account:function:calculate-discount",
  "InputPath": "$",
  "Parameters": {
    "itemList.$": "$.items",
    "customerId.$": "$.customerId",
    "requestId.$": "$$.Execution.Id"
  },
  "ResultPath": "$.discount",
  "OutputPath": "$",
  "Next": "NextState"
}
```

3. **Parameters** now constructs the task input. The Lambda receives:

```json
{
  "itemList": ["A", "B"],
  "customerId": "cust-001",
  "requestId": "arn:aws:states:region:account:execution:state-machine-name:execution-id"
}
```

4. **The Lambda executes** and returns:

```json
{
  "discountPercentage": 10,
  "discountedAmount": 90
}
```

5. **ResultPath: "$.discount"** merges this result into the state input at the key "discount". The state output is now:

```json
{
  "customerId": "cust-001",
  "items": ["A", "B"],
  "originalAmount": 100,
  "metadata": {"source": "mobile"},
  "discount": {
    "discountPercentage": 10,
    "discountedAmount": 90
  }
}
```

6. **OutputPath: "$"** passes the entire object to the next state.

If instead OutputPath were "$.discount", the next state would receive only:

```json
{
  "discountPercentage": 10,
  "discountedAmount": 90
}
```

This tracing exercise highlights why understanding the pipeline is so critical. Each field affects what data is available to the next, and mistakes compound quickly.

### Common Mistakes and How to Avoid Them

**Forgetting that ResultPath replaces by default.** Many developers set up a beautifully crafted state, their task returns important data, but then they're shocked to find that the original input is gone. The fix: explicitly set ResultPath to a nested path like `$.result` rather than relying on the default `$`.

**InputPath filters data that Parameters needs.** You define InputPath to clean up your input, select what matters, but then your Parameters references something that got filtered out. Always double-check that everything Parameters references is included in InputPath.

**Expecting OutputPath to reshape data.** OutputPath can only filter (select subsets), not restructure (reorganize fields, rename keys, merge objects). If you need to reshape, use a Pass state with Parameters before OutputPath, or handle it in your task's code.

**Assuming null ResultPath means the task output is ignored.** With `ResultPath: null`, the task still runs and completes normally. The output is simply discarded, and the state output is the state input. This is fine for side-effect operations, but don't use it if you need the result.

**Complex JSONPath expressions that are hard to reason about.** While JSONPath is powerful, deeply nested or complex filters can become unreadable. Sometimes it's clearer to use a simple InputPath and let your Lambda handle the data shaping.

**Not testing with real data.** InputPath, Parameters, ResultPath, and OutputPath all behave differently with different JSON structures. Test with actual data, not hypotheticals. Use the Step Functions console to trace execution and inspect what each state receives and outputs.

### Real-World Scenario: Building an Order Processing Workflow

Let's apply these concepts to a realistic scenario. You're building a workflow that processes e-commerce orders.

**Input to the state machine:**

```json
{
  "orderId": "ORD-12345",
  "customerId": "CUST-67890",
  "items": [
    {"sku": "WIDGET-A", "quantity": 2, "price": 29.99},
    {"sku": "GADGET-B", "quantity": 1, "price": 49.99}
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Springfield",
    "state": "IL",
    "zip": "62701"
  },
  "promoCode": "SAVE10"
}
```

**State 1: Validate Order**

```json
{
  "ValidateOrder": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:region:account:function:validate-order",
    "InputPath": "$",
    "Parameters": {
      "orderId.$": "$.orderId",
      "itemCount.$": "$.items | length(@)",
      "hasPromo.$": "$.promoCode != null"
    },
    "ResultPath": "$.validation",
    "OutputPath": "$",
    "Next": "ApplyDiscount"
  }
}
```

The Lambda receives a clean, small input with just what it needs. It returns `{"valid": true, "warnings": []}`. ResultPath: "$.validation" keeps this alongside the original data.

**State 2: Apply Discount**

```json
{
  "ApplyDiscount": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:region:account:function:calculate-discount",
    "InputPath": "$.promoCode",
    "Parameters": {
      "code.$": "$"
    },
    "ResultPath": "$.discount",
    "OutputPath": "$",
    "Next": "ProcessPayment"
  }
}
```

Here, InputPath extracts just the promo code. The Lambda gets a string instead of a large object. It returns `{"percentage": 10, "amount": 10.99}`, merged as "discount".

**State 3: Process Payment**

```json
{
  "ProcessPayment": {
    "Type": "Task",
    "Resource": "arn:aws:lambda:region:account:function:charge-card",
    "InputPath": "$",
    "Parameters": {
      "customerId.$": "$.customerId",
      "amount.$": "$.items[*].price * $.items[*].quantity | add(@) - $.discount.amount",
      "orderId.$": "$.orderId"
    },
    "ResultPath": "$.payment",
    "OutputPath": "$",
    "Next": "SendConfirmation"
  }
}
```

Parameters uses a more complex JSONPath to calculate the final amount. The result includes transaction ID and confirmation code, merged under "payment".

**State 4: Send Confirmation**

```json
{
  "SendConfirmation": {
    "Type": "Task",
    "Resource": "arn:aws:sns:region:account:topic",
    "InputPath": "$",
    "Parameters": {
      "Message.$": "States.Format('Order {} confirmed. Total: ${}', $.orderId, $.payment.finalAmount)",
      "PhoneNumber.$": "$.customerId"
    },
    "ResultPath": null,
    "OutputPath": "$.orderId",
    "Next": "Success"
  }
}
```

ResultPath: null discards the SNS response (we don't care). OutputPath: "$.orderId" sends just the order ID to the next state, keeping the workflow output minimal.

Notice how each state uses these fields strategically:
- InputPath cleans up what the task sees.
- Parameters shapes the exact input the task receives.
- ResultPath determines how the result integrates with the workflow state.
- OutputPath controls what flows downstream.

By the end, you have precise control over data flow, minimal data passing through the system, and clear intent at each stage.

### JSONPath Syntax Quick Reference

Understanding JSONPath is fundamental to using InputPath, Parameters, and OutputPath effectively. Here are the patterns you'll use most often:

`$` selects the root object (the entire input).

`$.fieldName` selects a specific field. `$.orderId` gets the orderId field.

`$.nested.field` drills down into nested objects. `$.address.city` gets the city from an address object.

`$[0]` selects the first element of an array. `$.items[0]` gets the first item.

`$.items[*]` selects all elements of an array. Often used with aggregation functions like `length(@)` or `add(@)`.

`$.items[?(@.sku == 'WIDGET-A')]` filters an array based on a condition.

`$.items | length(@)` applies the length function to count items.

`$.price * 1.1` performs arithmetic (multiply price by 1.1).

`States.Format()`, `States.StringToJson()`, and other intrinsic functions perform transformations. These are Step Functions–specific extensions to JSONPath.

In Parameters, remember that you use `.$` suffix to indicate a JSONPath expression. Without the suffix, it's treated as a literal string.

### Debugging Data Flow with the Step Functions Console

Theory is great, but nothing beats seeing data flow in action. The Step Functions console shows you exactly what each state receives and outputs. When building or troubleshooting, trace through an execution and examine the input and output of each state. Look for:

- Is the InputPath extracting what I expect?
- Does the Parameters input to the task match what the task expects?
- Did the task return what I anticipated?
- Is ResultPath merging correctly, or is data being lost?
- Does OutputPath include everything the next state needs?

If something's unexpected, it's usually one of these four fields. The console makes it easy to spot.

### Conclusion

InputPath, Parameters, ResultPath, and OutputPath form the backbone of data flow in AWS Step Functions. They're not advanced features you might never need—they're core to every state machine you build. Mastering them means you can construct clean, efficient workflows where data flows predictably from state to state, where each task receives exactly what it needs, and where no data is unexpectedly lost or duplicated.

The key insights to remember: InputPath filters input before Parameters, Parameters shapes the task input, ResultPath decides how the task result integrates with the state output, and OutputPath filters what leaves the state. They execute in that order, each one affecting what the next can access. When you trace through a complex workflow, trace through this pipeline for each state, and you'll quickly understand what's happening.

Start with simple patterns—use Parameters to shape task input, use ResultPath to nest results, use OutputPath only when you truly need to filter. As your workflows grow more complex, these fields give you the precision to keep data organized, reduce noise, and build robust orchestrations that other developers can understand at a glance.
