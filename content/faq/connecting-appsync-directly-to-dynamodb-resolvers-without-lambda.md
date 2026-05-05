---
title: "Connecting AppSync Directly to DynamoDB: Resolvers Without Lambda"
---

## Connecting AppSync Directly to DynamoDB: Resolvers Without Lambda

When you're building GraphQL APIs on AWS, the question of how to connect your resolvers to data is fundamental. Many developers assume they need Lambda functions as intermediaries—a safe, familiar pattern that works well in many scenarios. But there's a faster, cheaper, and often simpler path that AWS AppSync offers directly: connecting your resolvers straight to DynamoDB without any Lambda in between.

This direct connection pattern is one of the most practical and commonly used configurations in real-world AppSync deployments. It eliminates cold starts, reduces operational overhead, and cuts costs by removing an extra layer of compute. In this guide, we'll walk through how to set this up, what operations are available to you, and how to design your GraphQL schema to work effectively with DynamoDB's data model.

### Understanding AppSync Resolvers and Data Sources

Before diving into the specifics of DynamoDB integration, let's establish what a resolver actually does. In AppSync, a resolver is a piece of logic that connects a GraphQL field to actual data. When a client requests a field in your GraphQL query, AppSync executes the resolver for that field to fetch or manipulate the underlying data.

Traditionally, developers route these requests through Lambda functions. Lambda gives you complete flexibility—you can write arbitrary logic, call multiple services, transform data however you want, and handle complex business rules. It's powerful, but it comes with a cost: the function needs to initialize, you're paying for compute time, and there's a latency penalty from the additional hop.

The direct DynamoDB integration takes a different approach. Instead of writing Lambda code, you write what's called a VTL (Velocity Template Language) resolver. VTL is a simple templating language that AppSync uses to directly construct DynamoDB API requests. You define what operation to perform (GetItem, PutItem, Query, etc.) and AppSync handles the execution against your DynamoDB table without invoking any compute function. This approach is significantly faster and cheaper when your use case fits the pattern.

### The IAM Service Role: AppSync's Permissions Foundation

For AppSync to call DynamoDB on your behalf, it needs permissions. This is where the AppSync service role comes into play.

When you create an AppSync API, you provide (or let AWS create) an IAM role that AppSync assumes when executing your resolvers. This role is critical to security—it determines exactly which DynamoDB tables and operations AppSync is allowed to perform. You're not giving AppSync blanket access to your entire AWS account; you're granting specific, scoped permissions.

Here's what a minimal IAM policy for AppSync to read and write to a specific DynamoDB table looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/YourTableName"
    }
  ]
}
```

Notice that this policy lists specific actions. If you need to support transactions, you'd add `dynamodb:TransactWriteItems`. If your table has a Global Secondary Index (GSI) that you'll query, you might add the same actions but with the GSI ARN in the Resource field.

The principle here is least privilege: grant AppSync only the permissions it actually needs. If a particular GraphQL mutation doesn't require Scan operations, don't give AppSync permission to scan. This limits the blast radius if something goes wrong or if there's a vulnerability in your resolver logic.

### Supported DynamoDB Operations in AppSync Resolvers

AppSync's direct DynamoDB integration supports a curated set of operations, each mapped to common GraphQL patterns. Let's walk through each one and understand when you'd use it.

**GetItem** retrieves a single item by its primary key. This is the workhorse operation for most GraphQL queries where you're fetching a specific record. In your VTL resolver, you specify the table name and the key attributes. AppSync constructs the DynamoDB request, executes it, and returns the item.

**PutItem** writes a new item or overwrites an existing one completely. It's useful for mutations that create new records. One important detail: PutItem replaces the entire item, so if you send a PutItem with only some attributes, other attributes on the existing item will be deleted.

**UpdateItem** modifies specific attributes of an existing item without replacing the whole thing. This is more surgical than PutItem and is what you typically want for mutations that change a subset of fields. UpdateItem supports attribute actions like SET, ADD, REMOVE, and DELETE, giving you fine-grained control over what changes.

**DeleteItem** removes an item from the table by its primary key. It's straightforward and maps naturally to mutation operations that remove records.

**Query** retrieves multiple items that share the same partition key, optionally filtered by sort key conditions. This is essential for one-to-many relationships. For example, querying all orders for a specific customer. Query is also the most efficient way to retrieve items from a table or GSI when you know the partition key.

**Scan** reads all items from a table or index. Unlike Query, Scan doesn't require a partition key and will iterate through the entire table if needed. This is powerful but can be slow and expensive on large tables. Use it cautiously in production and always consider pagination.

**BatchGetItem** fetches multiple items in a single request by specifying multiple keys. It's more efficient than calling GetItem multiple times and maps well to GraphQL list queries where you have multiple specific IDs to fetch.

**TransactWriteItems** groups multiple write operations (Put, Update, Delete) into a single atomic transaction. If any operation fails, all operations in the transaction roll back. This is crucial for maintaining data consistency when you need to modify multiple items as a logical unit.

Each of these operations is accessible through VTL resolver code. You don't write raw JSON or use the AWS SDK; instead, you use AppSync's VTL context object and helper functions to construct the request.

### Writing VTL Resolvers for DynamoDB Operations

Let's look at what actual resolver code looks like. VTL resolvers consist of two parts: the request resolver (which prepares the request to send to DynamoDB) and the response resolver (which processes DynamoDB's response and returns it to the GraphQL client).

Here's a simple GetItem resolver for fetching a user by ID:

```velocity
## Request resolver
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.userId)
  }
}
```

This request resolver tells AppSync to perform a GetItem operation on the user ID passed as a GraphQL argument. The `$util.dynamodb.toDynamoDBJson()` function converts the GraphQL value into DynamoDB's JSON format. AppSync automatically executes this against the DynamoDB table connected to your data source.

The response resolver then handles what comes back:

```velocity
## Response resolver
#if($ctx.error)
  $util.error("Failed to fetch user")
#else
  $util.toJson($ctx.result)
#end
```

This checks if there was an error during execution and either returns the error or converts the DynamoDB result back to JSON for the GraphQL response. In many simple cases, you don't even need a response resolver—AppSync will automatically convert the DynamoDB result to the right GraphQL type.

Now let's look at something slightly more complex: a Query operation to fetch all orders for a customer.

```velocity
## Request resolver for querying orders by customer ID
{
  "version": "2017-02-28",
  "operation": "Query",
  "index": "customerIdIndex",
  "query": {
    "expression": "customerId = :customerId",
    "expressionValues": {
      ":customerId": $util.dynamodb.toDynamoDBJson($ctx.args.customerId)
    }
  },
  "limit": $ctx.args.limit,
  "nextToken": $ctx.args.nextToken
}
```

This resolver queries a Global Secondary Index named `customerIdIndex` for all items matching the given customer ID. The `expression` and `expressionValues` work similarly to DynamoDB's query conditions. The `limit` and `nextToken` support pagination, allowing clients to fetch results in chunks.

For mutations, here's an UpdateItem example that partially updates a user:

```velocity
## Request resolver for updating a user
{
  "version": "2017-02-28",
  "operation": "UpdateItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.userId)
  },
  "update": {
    "expression": "SET #name = :name, #email = :email, #updatedAt = :updatedAt",
    "expressionNames": {
      "#name": "name",
      "#email": "email",
      "#updatedAt": "updatedAt"
    },
    "expressionValues": {
      ":name": $util.dynamodb.toDynamoDBJson($ctx.args.name),
      ":email": $util.dynamodb.toDynamoDBJson($ctx.args.email),
      ":updatedAt": $util.dynamodb.toDynamoDBJson($util.now())
    }
  }
}
```

Notice the use of `expressionNames` (like `#name`) to handle attribute names that might conflict with DynamoDB reserved words, and `expressionValues` to safely pass values. This is the same syntax you'd use in the AWS SDK or CLI when working with DynamoDB.

### Conditional Expressions and Error Handling

DynamoDB supports conditional expressions—checks that must pass before an operation executes. AppSync exposes this capability through resolvers, which is invaluable for preventing race conditions and enforcing business logic.

Imagine you're updating a user's email address but only if the current email matches a specific value (to prevent concurrent updates from overwriting each other):

```velocity
## UpdateItem with a condition
{
  "version": "2017-02-28",
  "operation": "UpdateItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.userId)
  },
  "update": {
    "expression": "SET #email = :newEmail",
    "expressionNames": {
      "#email": "email"
    },
    "expressionValues": {
      ":newEmail": $util.dynamodb.toDynamoDBJson($ctx.args.newEmail),
      ":currentEmail": $util.dynamodb.toDynamoDBJson($ctx.args.currentEmail)
    }
  },
  "condition": {
    "expression": "#email = :currentEmail",
    "expressionNames": {
      "#email": "email"
    },
    "expressionValues": {
      ":currentEmail": $util.dynamodb.toDynamoDBJson($ctx.args.currentEmail)
    }
  }
}
```

If the condition fails (the current email doesn't match what's expected), DynamoDB returns an error without executing the update. You handle this in the response resolver:

```velocity
#if($ctx.error)
  #if($ctx.error.type == "ConditionalCheckFailedException")
    $util.error("Email address has changed. Please refresh and try again.")
  #else
    $util.error("Failed to update user: " + $ctx.error.message)
  #end
#else
  $util.toJson($ctx.result)
#end
```

This pattern is essential for building robust GraphQL APIs because it gives you consistency guarantees without requiring Lambda logic.

### Designing GraphQL Schemas for DynamoDB

One of the trickiest aspects of AppSync and DynamoDB integration is designing your GraphQL schema to work well with DynamoDB's data model. DynamoDB is a NoSQL database optimized for key-value and range queries, while GraphQL is optimized for flexible, hierarchical queries. Getting these to work together smoothly requires thoughtful schema design.

Many organizations use a single-table design in DynamoDB, where different entity types (users, orders, products) all live in one table, distinguished by composite primary keys. This approach is efficient for DynamoDB but can feel awkward when mapping to GraphQL.

Let's say you have a single table with a partition key of `PK` and sort key of `SK`. A user might have `PK = USER#123` and `SK = METADATA`. An order might have `PK = USER#123` and `SK = ORDER#456`. In GraphQL, you want to expose this naturally: a user type with associated orders, without forcing clients to understand the internal key structure.

Here's one approach—define separate GraphQL types but implement the resolvers to query the same underlying table:

```graphql
type User {
  id: String!
  name: String!
  email: String!
  orders: [Order!]!
}

type Order {
  id: String!
  userId: String!
  amount: Float!
  createdAt: String!
}

type Query {
  user(id: String!): User
  order(userId: String!, orderId: String!): Order
}
```

Your `user` query resolver would fetch the item with `PK = USER#<id>` and `SK = METADATA`. For the `orders` field on the User type, you'd write a resolver that queries the table with `PK = USER#<userId>` and `SK` begins with `ORDER#`.

The key insight is that your GraphQL schema can abstract away the single-table design details. Clients interact with a clean, logical schema while your resolvers handle the mapping to DynamoDB's structure.

### Pagination and Large Result Sets

When using Query or Scan operations that might return many items, pagination is critical. DynamoDB returns results in chunks and provides a `LastEvaluatedKey` that you can use to fetch the next page.

AppSync makes this straightforward:

```velocity
## Request resolver with pagination
{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "userId = :userId",
    "expressionValues": {
      ":userId": $util.dynamodb.toDynamoDBJson($ctx.args.userId)
    }
  },
  "limit": #if($ctx.args.limit) $ctx.args.limit #else 20 #end,
  "nextToken": #if($ctx.args.nextToken) "$ctx.args.nextToken" #else null #end
}
```

Your GraphQL schema would include a pagination wrapper:

```graphql
type OrderConnection {
  items: [Order!]!
  nextToken: String
}

type Query {
  userOrders(userId: String!, limit: Int, nextToken: String): OrderConnection!
}
```

In the response resolver, you extract the items and next token:

```velocity
{
  "items": $ctx.result.items,
  "nextToken": $ctx.result.nextToken
}
```

Clients can then use the `nextToken` from one response as input to the next query to fetch the following page. This is a standard GraphQL pagination pattern and works elegantly with DynamoDB's pagination model.

### Cost and Performance Benefits

The direct DynamoDB integration offers significant advantages over a Lambda-based approach for many use cases.

**Performance**: Direct DynamoDB calls have lower latency. There's no Lambda cold start, no initialization overhead, and no serialization/deserialization between services. A simple GetItem through AppSync's DynamoDB resolver typically completes in single-digit milliseconds, whereas the same operation through Lambda might take 50-200ms when you account for all the overhead.

**Cost**: You pay only for DynamoDB read and write capacity units. With Lambda, you're paying for compute time on top of the DynamoDB costs. If you're handling thousands of requests per second, the difference is substantial. AppSync itself charges per million requests, but there's no additional Lambda invocation cost when you use the direct integration.

**Operational Simplicity**: You don't need to write, test, deploy, and monitor Lambda code. Your resolver logic is inline and easier to reason about. Debugging is simpler because there's one fewer layer of indirection.

That said, there are scenarios where Lambda remains the right choice. If your resolver needs to call multiple services, run complex business logic, integrate with external APIs, or perform operations that DynamoDB doesn't support directly, Lambda is your tool. The direct DynamoDB integration is purpose-built for data access patterns that fit DynamoDB's capabilities.

### Practical Example: A Complete User Management API

Let's tie this together with a complete example. Imagine you're building an API for managing users and their profiles.

Your DynamoDB table might have:
- Partition key: `userId`
- Sort key: `entityType` (e.g., `USER#METADATA`, `USER#PROFILE`)
- Global Secondary Index with partition key: `email` (for email lookups)

Your GraphQL schema:

```graphql
type User {
  id: String!
  email: String!
  name: String!
  createdAt: String!
}

type Query {
  user(id: String!): User
  userByEmail(email: String!): User
}

type Mutation {
  createUser(email: String!, name: String!): User!
  updateUser(id: String!, name: String!): User!
  deleteUser(id: String!): Boolean!
}
```

Your resolver for `Query.user`:

```velocity
## Request
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.args.id),
    "entityType": $util.dynamodb.toDynamoDBJson("USER#METADATA")
  }
}
```

Your resolver for `Query.userByEmail` (using the GSI):

```velocity
## Request
{
  "version": "2017-02-28",
  "operation": "Query",
  "index": "emailIndex",
  "query": {
    "expression": "#email = :email",
    "expressionNames": {
      "#email": "email"
    },
    "expressionValues": {
      ":email": $util.dynamodb.toDynamoDBJson($ctx.args.email)
    }
  }
}

## Response
#if($ctx.result.items.size() > 0)
  $util.toJson($ctx.result.items[0])
#else
  $util.retryOnConflict()
#end
```

Your resolver for `Mutation.createUser`:

```velocity
## Request
{
  "version": "2017-02-28",
  "operation": "PutItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($util.autoId()),
    "entityType": $util.dynamodb.toDynamoDBJson("USER#METADATA")
  },
  "attributeValues": {
    "email": $util.dynamodb.toDynamoDBJson($ctx.args.email),
    "name": $util.dynamodb.toDynamoDBJson($ctx.args.name),
    "createdAt": $util.dynamodb.toDynamoDBJson($util.now())
  }
}
```

Notice the use of `$util.autoId()` to generate a unique user ID and `$util.now()` for the current timestamp. AppSync provides these utility functions to simplify common tasks.

### Common Pitfalls and How to Avoid Them

As you build with this pattern, a few mistakes appear frequently.

**Forgetting to update the IAM role**: You write a resolver that tries to call an operation, and it fails silently (returns null or an error) because the AppSync service role doesn't have permission. Always double-check that your IAM policy includes the operations and tables your resolvers need.

**Attribute naming conflicts**: DynamoDB has reserved words (like `data`, `name`, `timestamp`). When you use these as attribute names, you must use expression names in your resolvers (`#data`, `#name`). It's easy to forget this and spend time debugging. Consider this when designing your DynamoDB schema—using slightly different names can save friction.

**N+1 query problems**: In GraphQL, if you have a list of orders and each order resolver makes a separate DynamoDB call to fetch customer details, you'll end up with one call per order. This is expensive and slow. Use BatchGetItem for these scenarios or structure your resolvers to minimize redundant calls.

**Unbounded Scans**: Using Scan without a limit or filter expression on large tables is a performance and cost disaster. Always think about whether you can use Query instead (which is more efficient), and always set reasonable limits.

**Not handling null values**: When a DynamoDB item is missing an optional attribute, it won't be present in the response. If your GraphQL type expects it, you might get unexpected null values. Design your schema to match your data model, and consider what null means in each field.

### Testing Your Resolvers

Before deploying, test your resolvers thoroughly. AppSync provides a built-in query editor where you can test resolvers against your actual data. You can also use the CloudFormation or Terraform to define your AppSync API and test it locally with tools like the Serverless Framework or AWS SAM.

When testing, pay attention to error messages from DynamoDB. They're usually descriptive—validation errors, condition failures, and permission errors all come through clearly. Use this information to fix your resolver logic quickly.

### Moving Beyond the Basics

Once you're comfortable with basic GetItem and PutItem operations, explore more advanced patterns. TransactWriteItems opens up possibilities for multi-item consistency. Complex Query expressions with filter conditions let you implement sophisticated business logic. Combining UpdateItem with ADD operations enables atomic counters without race conditions.

The AppSync documentation includes examples for each operation, and AWS provides sample projects that demonstrate real-world patterns. Spending time with these resources will deepen your understanding and help you recognize when the direct DynamoDB integration is the right choice for your problem.

### Conclusion

The direct DynamoDB integration in AppSync is one of the most powerful and underutilized features of the service. For any GraphQL API that primarily reads from and writes to DynamoDB, it offers a path to faster, cheaper, and operationally simpler systems than Lambda-based architectures. By understanding the available operations, mastering VTL resolver syntax, and designing your schema thoughtfully around DynamoDB's data model, you can build highly efficient APIs that scale with your traffic.

The pattern isn't a silver bullet—Lambda still has its place for complex business logic and multi-service orchestration. But for data access, AppSync's direct DynamoDB resolvers should be your default starting point. Start simple with GetItem and Query operations, understand how IAM roles protect your data, and gradually add more sophisticated patterns like transactions and conditional expressions as your needs grow. You'll find that most of what you need to build a robust GraphQL API is available without ever touching a Lambda function.
