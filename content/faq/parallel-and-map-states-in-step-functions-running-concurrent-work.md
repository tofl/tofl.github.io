---
title: "Parallel and Map States in Step Functions: Running Concurrent Work"
---

## Parallel and Map States in Step Functions: Running Concurrent Work

When you're orchestrating workflows with AWS Step Functions, you'll inevitably encounter scenarios where sequential execution simply won't cut it. Maybe you need to fetch user data from three different microservices, or process thousands of items in a dataset. That's where Parallel and Map states become invaluable. These state types let you run work concurrently rather than waiting for each task to complete before starting the next one—a capability that can dramatically improve performance and reduce overall execution time.

In this guide, we'll explore how Parallel and Map states work, when to use each one, how to handle failures when multiple branches execute simultaneously, and what you need to know about managing concurrency and costs. By the end, you'll understand not just the mechanics of these states, but how to apply them strategically to build efficient, resilient workflows.

### Understanding the Parallel State

The Parallel state lets you define multiple branches of execution that run at the same time. Each branch can contain any valid Step Functions state—Tasks, Choices, nested Parallel states, you name it. Step Functions launches all branches immediately and waits for every single branch to complete before moving to the next state.

This is fundamentally different from a Choice state, which evaluates a condition and follows one path. A Parallel state explores all paths simultaneously.

Here's the core concept: imagine you're building an order fulfillment workflow. After an order is received, you need to simultaneously check inventory in your warehouse system, calculate shipping costs, and verify payment authorization. Rather than waiting for inventory to complete before checking payment, you can run all three checks in parallel. Only when all three branches have finished does your workflow proceed to the next step.

The output from a Parallel state is always an array, where each element corresponds to the output of each branch in the order they were defined. This is important for understanding how to structure your subsequent states.

Let's look at a concrete example. Here's a state machine definition that fetches data from multiple APIs in parallel:

```json
{
  "StartAt": "FetchDataInParallel",
  "States": {
    "FetchDataInParallel": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "FetchUserData",
          "States": {
            "FetchUserData": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:GetUserInfo",
              "End": true
            }
          }
        },
        {
          "StartAt": "FetchOrderHistory",
          "States": {
            "FetchOrderHistory": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:GetOrders",
              "End": true
            }
          }
        },
        {
          "StartAt": "FetchPreferences",
          "States": {
            "FetchPreferences": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:GetPreferences",
              "End": true
            }
          }
        }
      ],
      "Next": "CombineResults"
    },
    "CombineResults": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:MergeData",
      "End": true
    }
  }
}
```

When this state machine executes, all three Lambda functions are invoked at essentially the same time. If each normally takes two seconds to run, executing them sequentially would take six seconds. Running them in parallel takes roughly two seconds (plus small coordination overhead).

The output of the Parallel state is an array like this:

```json
[
  { "userId": "user123", "name": "Jane Doe" },
  { "orders": [ { "id": "order1", "total": 99.99 } ] },
  { "theme": "dark", "notifications": true }
]
```

Notice how the results appear in the exact order the branches were defined, even if one branch finishes before another. Step Functions maintains this ordering because it's critical for predictability—your downstream tasks need to reliably know which result came from which branch.

### Understanding the Map State

The Map state is for a different but equally important scenario: when you have a collection of items and you want to perform the same processing on each one, ideally in parallel. Think of it as applying a function to every element in an array.

Imagine you have 1,000 product images that need to be resized and have thumbnails generated. You could invoke a Lambda function once for each image sequentially—which would take forever. Or you could use a Map state to process multiple images concurrently.

Here's how a Map state looks:

```json
{
  "StartAt": "ProcessImages",
  "States": {
    "ProcessImages": {
      "Type": "Map",
      "ItemsPath": "$.images",
      "MaxConcurrency": 10,
      "Iterator": {
        "StartAt": "ResizeImage",
        "States": {
          "ResizeImage": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ResizeImage",
            "End": true
          }
        }
      },
      "ResultPath": "$.processedImages",
      "Next": "AllDone"
    },
    "AllDone": {
      "Type": "Pass",
      "End": true
    }
  }
}
```

The key differences from Parallel:

**ItemsPath** tells the Map state which part of the input data contains the array to iterate over. In this example, it expects the input to have a structure like `{ "images": [ { "url": "..." }, ... ] }`. If you don't specify ItemsPath, it assumes the entire input is an array.

**Iterator** defines the workflow that runs for each item. Each invocation of the iterator receives a single item from the array as its input. If your input array has 100 items, the Iterator workflow runs 100 times.

**MaxConcurrency** is the safety valve. It controls how many iterations can run at the same time. Setting this to 10 means Step Functions will never launch more than 10 concurrent executions of the iterator. Once one iteration completes, the next waiting item can start. This is crucial for controlling costs and avoiding resource exhaustion.

**ResultPath** determines where the output array gets placed in the result. If you set it to `$.processedImages`, the output will be structured like:

```json
{
  "images": [ ... ],
  "processedImages": [ 
    { "success": true, "thumbnail": "s3://..." },
    { "success": true, "thumbnail": "s3://..." },
    ...
  ]
}
```

If you set ResultPath to null, the original input is discarded and replaced entirely by the array of results.

### Choosing Between Parallel and Map

The distinction is conceptually clean: use Parallel when you have a fixed, small set of distinct branches that do different things. Use Map when you have a collection of items and want to process each one the same way.

In practice, Parallel states are ideal for fan-out scenarios—checking multiple systems for different information. Map states excel at bulk processing. But they're not mutually exclusive. You can nest a Map state inside a Parallel branch, or use a Parallel state as the iterator of a Map state, depending on your workflow's requirements.

Here's a realistic scenario that benefits from both: you're processing customer orders. First, you run a Parallel state with three branches—one to validate payment, one to check inventory, and one to calculate shipping. Once those parallel checks complete, you then use a Map state to process each item in the order concurrently (resizing images, generating SKUs, etc.).

### Controlling Concurrency with MaxConcurrency

The MaxConcurrency parameter exists for good reasons. Without it, a Map state could theoretically try to process thousands of items simultaneously, causing several problems: you could hit rate limits on downstream services, exhaust Lambda concurrency limits, run up enormous AWS bills, or overwhelm databases with connection pools.

By setting MaxConcurrency to a reasonable value—say 5 or 10 for most workloads—you ensure controlled, predictable resource usage. Step Functions maintains a queue of pending items and launches new iterations as running ones complete, never exceeding the limit.

Note that Parallel states don't have a MaxConcurrency parameter because they're meant for small, fixed sets of branches. If you try to create a Parallel state with thousands of branches, that's a sign you actually need a Map state.

### Error Handling in Parallel and Map States

When you run work concurrently, error handling becomes more nuanced. What happens if one branch fails while others are still running?

By default, if any single branch in a Parallel state fails, the entire Parallel state fails immediately. The other branches are not automatically terminated—they continue running in the background—but the state machine transitions to an error state. This "fail-fast" behavior makes sense for many scenarios: if checking payment authorization fails, you probably want to stop the whole workflow rather than continuing with inventory checks.

However, you can override this with the `Catch` property, which lets you handle errors and decide what to do next:

```json
{
  "StartAt": "FetchDataInParallel",
  "States": {
    "FetchDataInParallel": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "FetchUserData",
          "States": {
            "FetchUserData": {
              "Type": "Task",
              "Resource": "arn:aws:lambda:us-east-1:123456789012:function:GetUserInfo",
              "Catch": [
                {
                  "ErrorEquals": ["States.TaskFailed"],
                  "Next": "HandleUserDataFailure"
                }
              ],
              "End": true
            },
            "HandleUserDataFailure": {
              "Type": "Pass",
              "Result": { "error": "Could not fetch user data" },
              "End": true
            }
          }
        }
      ],
      "Next": "ProcessResults"
    },
    "ProcessResults": {
      "Type": "Pass",
      "End": true
    }
  }
}
```

With error handling at the task level within each branch, you can gracefully degrade—perhaps returning a default value or a placeholder when one data source fails, but still allowing other branches to complete and the workflow to proceed.

For Map states, error handling is similar but with an additional consideration. If you don't use Catch, a single item failure causes the entire Map state to fail. But you can catch errors within the Iterator:

```json
{
  "StartAt": "ProcessImages",
  "States": {
    "ProcessImages": {
      "Type": "Map",
      "ItemsPath": "$.images",
      "MaxConcurrency": 5,
      "Iterator": {
        "StartAt": "ResizeImage",
        "States": {
          "ResizeImage": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ResizeImage",
            "Catch": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "Next": "LogImageFailure"
              }
            ],
            "End": true
          },
          "LogImageFailure": {
            "Type": "Task",
            "Resource": "arn:aws:lambda:us-east-1:123456789012:function:LogError",
            "End": true
          }
        }
      },
      "Next": "AllDone"
    },
    "AllDone": {
      "Type": "Pass",
      "End": true
    }
  }
}
```

This approach lets you continue processing other items even if one fails, logging the failures along the way. The Map state itself succeeds, and you have a record of what went wrong.

### Combining Results with ResultPath

Understanding ResultPath is essential for working with Parallel and Map states because it determines how outputs are merged with (or replace) the input data.

Let's revisit our earlier example. After the Parallel state completes, you have an array of three results. But your next task might expect the data in a different structure. The ResultPath parameter lets you reshape things.

Consider this input:

```json
{
  "customerId": "cust123",
  "action": "fetchAll"
}
```

After the Parallel state executes, the default output is:

```json
[
  { "userId": "user123", "name": "Jane" },
  { "orders": [ { "id": "order1" } ] },
  { "preferences": { "theme": "dark" } }
]
```

But maybe you want to preserve the original customerId for downstream use. You can set ResultPath to:

```json
"ResultPath": "$.data"
```

Now the output becomes:

```json
{
  "customerId": "cust123",
  "action": "fetchAll",
  "data": [
    { "userId": "user123", "name": "Jane" },
    { "orders": [ { "id": "order1" } ] },
    { "preferences": { "theme": "dark" } }
  ]
}
```

If you set `"ResultPath": null`, the original input is discarded entirely and only the results remain. This is useful when you don't need the original context anymore.

For Map states, ResultPath works similarly. The output of the iterator (the processed items) is placed at the path you specify, allowing you to keep or discard the original input collection.

### Performance and Cost Implications

Parallel and Map states are powerful optimization tools, but they're not free. Here's what you need to consider:

**Execution time** generally decreases with parallelism. Three tasks that each take two seconds, run in sequence, take six seconds total. Run in parallel, they take roughly two seconds. The overhead of Step Functions coordination is minimal—we're talking tens of milliseconds.

**Cost structure** in Step Functions is based on the number of state transitions, not execution time. A Parallel state with three branches counts as four state transitions (the Parallel state itself plus one for each branch completing). A Map state with 1,000 items counts as 1,001 transitions (the Map state plus one per item). So paradoxically, running things in parallel might increase your Step Functions costs slightly compared to running them sequentially—but the reduction in overall time, especially in Lambda execution time, usually more than compensates.

**Resource limits** are your real constraint. If your Parallel state invokes three Lambda functions simultaneously, you're consuming three concurrent Lambda executions. If you have a Map state processing 100 items with MaxConcurrency set to 20, you're consuming 20 Lambda invocations at a time. This is usually fine, but if your account is running near its concurrency limit, you need to be aware.

**Downstream system load** is another practical consideration. If your Parallel state invokes three API calls to a single database, you might overwhelm it. If your Map state tries to process 1,000 items simultaneously against a rate-limited API, you'll hit throttling errors. Setting appropriate MaxConcurrency values prevents this.

### Real-World Use Cases

**Data enrichment pipelines** benefit tremendously from Parallel states. Imagine processing a user registration. You need to fetch their credit history from one service, check their email against a fraud database from another, and verify their identity with a third. Running these three checks in parallel reduces latency from three seconds to one.

**Bulk processing workflows** are perfect for Map states. A retail company receives 10,000 product catalog updates daily. Using a Map state with MaxConcurrency set to 50, they can process all 10,000 updates in under a minute, with each update being validated, categorized, and stored in parallel.

**ETL pipelines** often combine both. The Parallel state might simultaneously extract data from three different source systems. Then a Map state processes the combined dataset, transforming and validating each record. The hybrid approach provides both speed and resource control.

**Microservices orchestration** is another sweet spot. When a request requires coordination across five different services, a Parallel state fans out to all of them, then aggregates the responses. This pattern is orders of magnitude faster than sequential service calls.

### Practical Considerations and Best Practices

When designing Parallel and Map states, keep a few things in mind:

Start conservatively with MaxConcurrency. You can always increase it later if monitoring shows you have headroom. It's better to discover that you can handle more concurrency than to overwhelm downstream systems. A good starting point is often 5 to 10 concurrent executions for most workloads.

Monitor your state machine executions. Step Functions integrates with CloudWatch, so you can track execution duration, failure rates, and state transitions. If you notice that a particular branch in a Parallel state is consistently slower than others, that might be a bottleneck worth investigating. If a Map state is processing items much slower than expected, check whether downstream systems are throttling you.

Consider idempotency. When work runs in parallel, the exact timing of operations becomes less predictable. If you have two Map iterations that write to the same resource, ensure the operation is idempotent—running it twice produces the same result as running it once.

Understand the limits. Step Functions has execution history limits and state machine size limits. A Map state with 100,000 items is technically possible but might hit practical limits on execution history. For very large datasets, consider batching them into smaller chunks or using a different approach like SQS + Lambda.

### Troubleshooting Common Issues

Sometimes a Parallel or Map state doesn't behave as expected. Here are some common issues:

**All branches failing simultaneously** often indicates a shared dependency problem—perhaps all branches invoke the same service and that service is down. Check CloudWatch logs for the actual error messages.

**Inconsistent output ordering** is usually a misunderstanding of how ResultPath works. Remember that Parallel state outputs are always in branch order, not completion order. If this isn't what you need, you can post-process the results in a subsequent Task state.

**Unexpectedly high costs** with Map states usually comes from setting MaxConcurrency too high or processing more items than anticipated. Review your MaxConcurrency setting and check exactly how many items your ItemsPath expression is selecting.

**Timeouts** in Map states often happen when you've set MaxConcurrency too high and downstream resources start timing out due to overload. Lower MaxConcurrency and rerun.

### Conclusion

Parallel and Map states transform Step Functions from a tool for sequential workflows into a powerful orchestrator of concurrent work. Parallel states are your solution for fan-out scenarios where you need multiple branches executing simultaneously. Map states handle bulk processing elegantly, iterating over collections with controlled concurrency. Together, they enable you to build workflows that are not only faster but also more efficient and cost-effective.

The key is understanding when to use each one, how to handle failures gracefully, and how to manage concurrency sensibly. Start with conservative MaxConcurrency settings, monitor your executions, and adjust as your understanding of your workload grows. With these tools in your Step Functions toolkit, you can build scalable, resilient workflows that handle real-world complexity.
