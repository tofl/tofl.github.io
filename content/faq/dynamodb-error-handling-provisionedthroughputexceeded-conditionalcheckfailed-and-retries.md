---
title: "DynamoDB Error Handling: ProvisionedThroughputExceeded, ConditionalCheckFailed, and Retries"
---

# DynamoDB Error Handling: ProvisionedThroughputExceeded, ConditionalCheckFailed, and Retries

When you first start working with Amazon DynamoDB, you're usually impressed by how fast it responds to your queries. But as your application scales, you'll inevitably encounter scenarios where DynamoDB pushes back: requests get throttled, conditional writes fail, or transactions roll back unexpectedly. Understanding how to handle these errors gracefully is what separates a prototype from production-ready code.

In this article, we'll explore the most common DynamoDB exceptions you'll encounter, what they really mean, and how to write application code that handles them intelligently. We'll cover the automatic retry mechanisms built into the AWS SDK, understand when to retry and when to fail fast, and learn how to instrument your code with CloudWatch metrics so you can see problems before they become disasters.

### Understanding DynamoDB Errors and When They Occur

DynamoDB communicates problems through a set of well-defined exceptions. Unlike some cloud services that throw generic errors, DynamoDB is quite specific about what went wrong. This precision is actually a gift—it means your code can respond intelligently rather than playing guessing games.

The errors generally fall into three categories: capacity and throttling issues, conditional failures during writes, and validation or resource problems. Each requires a different response strategy. Some errors are temporary and deserve a retry; others are permanent and indicate bugs in your code. Let's look at the most important ones.

### ProvisionedThroughputExceededException: When You Hit the Ceiling

This is the error you'll hear about most often, especially when you're ramping up in DynamoDB. It means your application tried to read or write more data than your table's provisioned capacity allows in that one-second window.

Here's what's actually happening under the hood: DynamoDB measures your throughput in one-second intervals. If you provision 100 write capacity units (WCU) and try to write 101 WCU's worth of data in a single second, the extra request gets rejected with `ProvisionedThroughputExceededException`. On-demand tables don't have this limit, but provisioned tables—which offer better cost efficiency at scale—absolutely do.

The good news is that this exception is *temporary* by definition. The capacity ceiling resets every second. This means retrying the request after a brief pause often succeeds. The AWS SDK for most languages bakes in automatic exponential backoff retry logic, which handles this scenario for you without requiring extra code.

Let's look at what this means in practice. Here's a simple write operation with the JavaScript SDK v3:

```javascript
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function saveUser(userId, userData) {
  try {
    const response = await client.send(
      new PutItemCommand({
        TableName: "Users",
        Item: {
          userId: { S: userId },
          email: { S: userData.email },
          createdAt: { N: String(Date.now()) },
        },
      })
    );
    console.log("Item saved successfully");
    return response;
  } catch (error) {
    if (error.name === "ProvisionedThroughputExceededException") {
      console.error("Request was throttled. SDK will retry automatically.");
    }
    throw error; // Re-throw so SDK retries kick in
  }
}
```

By default, the SDK will automatically retry requests that fail with `ProvisionedThroughputExceededException`. The SDK uses exponential backoff, meaning the first retry happens after roughly 50 milliseconds, the next after around 100 milliseconds, and so on. This strategy prevents your application from hammering DynamoDB while it recovers.

However, you have control over this behavior. You can configure the maximum number of retries and the backoff strategy when creating your client:

```javascript
const client = new DynamoDBClient({
  region: "us-east-1",
  maxAttempts: 3, // Total attempts (initial + retries)
  retryStrategy: new StandardRetryStrategy(async (delayMs) => {
    // Custom backoff logic if needed
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }),
});
```

This is where understanding your retry strategy matters. If you configure `maxAttempts: 3`, the SDK will try the request once, then retry twice more if needed—for a total of three attempts. The delays grow exponentially, so the aggregate wait time across all retries might be a few hundred milliseconds at most. If all three attempts fail, you'll get the exception thrown to your application code.

The key principle here is that `ProvisionedThroughputExceededException` almost always deserves a retry because it's transient. But you shouldn't implement manual retry loops yourself—the SDK does this correctly already. Instead, focus on understanding why you're getting throttled in the first place.

Common causes of throttling include traffic spikes (legitimate bursts that your provisioned capacity can't absorb), uneven distribution of requests across partition keys, or simply growing demand. The solution often involves provisioning more capacity, moving to on-demand billing if your workload is unpredictable, or optimizing your access patterns to avoid hot partitions.

### ConditionalCheckFailedException: Expected Behavior, Not an Error

This is where many developers trip up. `ConditionalCheckFailedException` gets thrown when you write an item with a condition and that condition evaluates to false. Your instinct might be to treat this as an error, but it's more accurate to think of it as a normal, expected outcome.

Conditional writes form the foundation of optimistic locking in DynamoDB. Imagine you're building a banking application where multiple processes might try to update an account balance simultaneously. You don't want to use pessimistic locking (which would serialize all updates), so instead, you include a version number in your item. When you update, you require that the version number matches what you last read. If someone else updated the item in between, the version won't match, and your update fails.

Here's what that looks like:

```javascript
async function updateAccountBalance(accountId, newBalance, expectedVersion) {
  try {
    const response = await client.send(
      new UpdateItemCommand({
        TableName: "Accounts",
        Key: { accountId: { S: accountId } },
        UpdateExpression: "SET balance = :balance, version = :newVersion",
        ConditionExpression: "version = :expectedVersion",
        ExpressionAttributeValues: {
          ":balance": { N: String(newBalance) },
          ":newVersion": { N: String(expectedVersion + 1) },
          ":expectedVersion": { N: String(expectedVersion) },
        },
        ReturnValues: "ALL_NEW",
      })
    );
    console.log("Balance updated successfully");
    return response.Attributes;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      console.log(
        "Update failed because item was modified. Client should retry from latest value."
      );
      // This is NOT an error condition—it's the normal outcome of optimistic locking
      // Your application should read the item again and retry
      return null;
    }
    throw error;
  }
}
```

The critical insight here is that `ConditionalCheckFailedException` is not something to log as a warning or error. It's the mechanism by which DynamoDB tells you your optimistic lock didn't succeed. You should handle it by re-reading the item (to get the latest version) and trying again. If this becomes a hot spot—where retries pile up—that's a signal that your versioning strategy or table design needs rethinking.

You can also use conditions to prevent overwrites of existing items, or to ensure certain attributes are present before allowing an update. These are all legitimate uses where `ConditionalCheckFailedException` means "your condition wasn't met," not "something broke."

### TransactionCanceledException: When Transactions Fail

DynamoDB supports multi-item transactions through `TransactWriteItems` and `TransactGetItems` operations. These allow you to atomically write or read multiple items across one or more tables. If any part of the transaction fails, the whole thing rolls back.

When a transaction fails, you get `TransactionCanceledException`. What makes this interesting is that this exception includes a `CancellationReasons` array—one entry for each item in your transaction. This tells you exactly which item caused the problem and why.

Here's a practical example. Imagine you're processing a payment where you need to debit an account and credit another account atomically:

```javascript
async function processPayment(fromAccountId, toAccountId, amount) {
  try {
    const response = await client.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: "Accounts",
              Key: { accountId: { S: fromAccountId } },
              UpdateExpression: "SET balance = balance - :amount",
              ConditionExpression: "balance >= :amount",
              ExpressionAttributeValues: {
                ":amount": { N: String(amount) },
              },
            },
          },
          {
            Update: {
              TableName: "Accounts",
              Key: { accountId: { S: toAccountId } },
              UpdateExpression: "SET balance = balance + :amount",
              ExpressionAttributeValues: {
                ":amount": { N: String(amount) },
              },
            },
          },
        ],
      })
    );
    console.log("Payment processed successfully");
    return true;
  } catch (error) {
    if (error.name === "TransactionCanceledException") {
      console.log("Transaction cancelled. Reasons:");
      error.CancellationReasons.forEach((reason, index) => {
        if (reason && reason.Message) {
          console.log(`Item ${index}: ${reason.Message}`);
        }
      });
      // First item failed: insufficient balance
      // or second item failed: account doesn't exist
      // Handle each case appropriately
      return false;
    }
    throw error;
  }
}
```

Each entry in `CancellationReasons` can tell you things like "ConditionalCheckFailed" for a condition expression that didn't pass, "ItemCollectionSizeLimitExceededException" if you're hitting GSI size limits, or "ValidationError" if the request was malformed. By inspecting these reasons, your code can decide whether to retry, alert an operator, or take some other action.

Note that `ProvisionedThroughputExceededException` can also occur during transactions. When it does, the SDK's automatic retry logic still applies, so you often won't even see this exception in your code.

### ValidationException: Your Request Is Malformed

`ValidationException` indicates that your request itself is wrong. Maybe you're referencing an attribute that doesn't exist in an expression, or your key schema is incorrect, or you've exceeded the size limit for an item (4 MB max).

This error is not transient. Retrying won't help because the problem is in your code or data, not in DynamoDB's capacity. It's a signal to fix your code. Here's an example:

```javascript
// This will throw ValidationException because ItemSize exceeds 400KB
const hugeData = "x".repeat(5 * 1024 * 1024); // 5 MB of data

try {
  await client.send(
    new PutItemCommand({
      TableName: "Documents",
      Item: {
        docId: { S: "doc-123" },
        content: { S: hugeData }, // Exceeds 4 MB limit
      },
    })
  );
} catch (error) {
  if (error.name === "ValidationException") {
    console.error("Your request is invalid. Fix your code, not your retry logic.");
    // Log the error message for debugging
    console.error(error.message);
  }
}
```

Common validation errors include malformed expressions, missing required parameters, attribute names that conflict with reserved words (though you can escape these with expression attribute names), and size violations. These are all programming errors, not infrastructure problems.

### ResourceNotFoundException: The Table Doesn't Exist

If you try to read from or write to a table that doesn't exist—or a table that was recently deleted—you'll get `ResourceNotFoundException`. Like validation errors, this is not transient. The table either exists or it doesn't, and retrying won't change that.

This error is especially useful during testing and in early development when table resources might not be created yet. It's also a good indicator of region or environment mismatches. Did you create your table in `us-east-1` but configure your application to use `eu-west-1`?

```javascript
try {
  await client.send(
    new GetItemCommand({
      TableName: "NonexistentTable",
      Key: { id: { S: "123" } },
    })
  );
} catch (error) {
  if (error.name === "ResourceNotFoundException") {
    console.error(
      "Table does not exist. Check table name and region configuration."
    );
    // In production, this should probably trigger an alert
  }
}
```

### Implementing Robust Error Handling

Now that we understand the common exceptions, let's look at how to structure your error handling. The pattern you should follow is: let the SDK handle retries automatically, but catch specific exceptions to make intelligent decisions about what happens next.

Here's a more complete example that demonstrates good practices:

```javascript
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  region: "us-east-1",
  maxAttempts: 3,
});

async function saveUserWithErrorHandling(userId, userData) {
  try {
    const response = await client.send(
      new PutItemCommand({
        TableName: "Users",
        Item: {
          userId: { S: userId },
          email: { S: userData.email },
          createdAt: { N: String(Date.now()) },
        },
      })
    );
    return { success: true, data: response };
  } catch (error) {
    // Transient errors already retried by SDK—these are final failures
    if (error.name === "ProvisionedThroughputExceededException") {
      return {
        success: false,
        error: "THROTTLED",
        message: "DynamoDB is at capacity. Consider increasing provisioned throughput or moving to on-demand.",
        retryable: true,
      };
    }

    // Programming errors
    if (error.name === "ValidationException") {
      return {
        success: false,
        error: "INVALID_REQUEST",
        message: error.message,
        retryable: false,
      };
    }

    // Infrastructure problems
    if (error.name === "ResourceNotFoundException") {
      return {
        success: false,
        error: "TABLE_NOT_FOUND",
        message: "The specified table does not exist.",
        retryable: false,
      };
    }

    // Unknown error
    return {
      success: false,
      error: "UNKNOWN_ERROR",
      message: error.message,
      retryable: false,
    };
  }
}
```

Notice that we're not catching `ProvisionedThroughputExceededException` and retrying manually. The SDK already retried (up to 3 times), and if we're seeing this exception, all retries have been exhausted. This is information for the caller to decide what to do—perhaps queue the request for later, alert an operator, or adjust pricing to on-demand.

### Idempotency and Retry Safety

When you retry requests, you need to be careful about idempotency. If your first request succeeded but the response was lost due to a network issue, and you retry, you don't want to create a duplicate write.

DynamoDB offers a built-in mechanism for this: conditional writes. If you include a condition that only allows the write if a specific attribute doesn't exist, you can safely retry. Or if you're using transactions with conditions that check version numbers or other state, you have protection against duplicates.

Here's an example using `attribute_not_exists()`:

```javascript
async function createUserIdempotent(userId, userData) {
  try {
    await client.send(
      new PutItemCommand({
        TableName: "Users",
        Item: {
          userId: { S: userId },
          email: { S: userData.email },
          createdAt: { N: String(Date.now()) },
        },
        ConditionExpression: "attribute_not_exists(userId)",
      })
    );
    return { success: true, created: true };
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      // User already exists—this is fine if we're in a retry scenario
      return { success: true, created: false, message: "User already existed" };
    }
    throw error;
  }
}
```

Now you can safely retry this operation. If the user already exists from a previous attempt, the condition fails, you catch it, and return success. The caller doesn't need to know whether the user was created on this attempt or a previous one.

### Monitoring and Observability with CloudWatch

Understanding that errors happen is one thing; knowing when they're happening in production is another. CloudWatch metrics are essential for visibility.

DynamoDB automatically publishes metrics to CloudWatch, including `ConsumedWriteCapacityUnits`, `ConsumedReadCapacityUnits`, `UserErrors`, and `SystemErrors`. The `UserErrors` metric includes things like validation errors and resource not found errors. `SystemErrors` includes throttling and other infrastructure issues.

You should also implement custom metrics for your application-level behavior:

```javascript
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const cloudwatch = new CloudWatchClient({ region: "us-east-1" });

async function recordDynamoDBError(errorType, tableName) {
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: "MyApp/DynamoDB",
      MetricData: [
        {
          MetricName: "ErrorCount",
          Value: 1,
          Unit: "Count",
          Dimensions: [
            { Name: "ErrorType", Value: errorType },
            { Name: "TableName", Value: tableName },
          ],
          Timestamp: new Date(),
        },
      ],
    })
  );
}
```

By tracking error types at the application level, you can set up alarms. For instance, if you start seeing frequent `ConditionalCheckFailedException` errors on your accounts table, that's a signal that your concurrency strategy needs adjustment.

### Best Practices Summary

Let's consolidate what we've learned into actionable practices:

When you encounter `ProvisionedThroughputExceededException` after SDK retries are exhausted, your option is to increase capacity or switch to on-demand billing. This is not a code problem; it's an infrastructure capacity problem.

Treat `ConditionalCheckFailedException` as normal when using optimistic locking. It's not an error—it's feedback that a condition didn't hold. Your code should handle it by re-reading fresh state and retrying.

For `TransactionCanceledException`, inspect the `CancellationReasons` array to understand which item caused the failure and why. This granular information lets you handle different failures appropriately.

Never retry in response to `ValidationException` or `ResourceNotFoundException`. These indicate bugs in your code or configuration. Fix the underlying issue instead of adding retry logic.

Always rely on the SDK's built-in retry mechanism rather than implementing your own. The SDK knows the right backoff strategy and handles all the edge cases.

Use conditional expressions to make your writes idempotent so retries are safe. The small performance cost of an extra condition is worth the safety guarantee.

Instrument your code with CloudWatch metrics so you can see problems emerging. Monitor not just system errors but also application-level concerns like how often conditional checks fail.

### Conclusion

DynamoDB errors are not obstacles—they're signals. `ProvisionedThroughputExceededException` tells you to plan capacity better. `ConditionalCheckFailedException` confirms your optimistic locking is working. `TransactionCanceledException` gives you surgical detail about what failed and why. By understanding what each exception means and building code that responds appropriately, you transform error handling from a burden into a feature that makes your application more resilient.

The AWS SDK handles many of these scenarios automatically, but the real skill comes from understanding the why behind the mechanism. When you grasp what DynamoDB is telling you through these exceptions, you can design applications that scale gracefully, recover from transient issues, and fail fast on real problems rather than thrashing with futile retries. That's the foundation of production-ready systems.
