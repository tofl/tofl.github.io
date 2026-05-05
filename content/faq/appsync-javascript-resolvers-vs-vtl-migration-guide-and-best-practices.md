---
title: "AppSync JavaScript Resolvers vs VTL: Migration Guide and Best Practices"
---

## AppSync JavaScript Resolvers vs VTL: Migration Guide and Best Practices

When you build a GraphQL API with AWS AppSync, you're making a choice about how to transform data between your GraphQL layer and your backend resources. For years, that choice meant learning Velocity Template Language (VTL)—a templating syntax that, while powerful, feels foreign to most JavaScript developers. Today, AppSync offers JavaScript resolvers as a modern alternative through the APPSYNC_JS runtime, and they're genuinely worth considering if you're building new APIs or modernizing existing ones.

This guide walks you through understanding AppSync's two resolver approaches, how they compare, what you need to know about JavaScript's limitations in this environment, and how to migrate from VTL if that's your path forward. By the end, you'll have a clear sense of which approach makes sense for your use case and how to implement it effectively.

### Understanding the Two Resolver Approaches

AppSync resolvers are the bridge between your GraphQL schema and your data sources. When a GraphQL query or mutation arrives, a resolver transforms the request, sends it to your backend (DynamoDB, Lambda, RDS, HTTP endpoints, etc.), and then transforms the response back into the shape your schema expects.

VTL has been AppSync's default for years. It's a template language derived from Apache Velocity, designed primarily for generating code and configuration files. In AppSync's context, you write request and response mapping templates that use a mix of directives, variables, and utility functions to build the final request object and parse the response. It works, and it's optimized for AppSync's specific needs, but it requires learning a syntax that most modern developers don't use anywhere else.

JavaScript resolvers using the APPSYNC_JS runtime let you write your resolver logic in a JavaScript subset that feels much more familiar to web developers. You get to write code that looks like what you write in Node.js—conditionals, loops, object destructuring, arrow functions—without the overhead of spinning up a Lambda function. The resolver executes in AppSync's native runtime, which is optimized for this specific task.

### The APPSYNC_JS Runtime: What's Included and What's Not

Before you commit to JavaScript resolvers, you need to understand what you're working with. The APPSYNC_JS runtime is deliberately constrained. It's not a Node.js environment, and trying to treat it like one will lead to frustration.

The JavaScript you can write is limited to a specific subset: ES2020 syntax is supported, which gives you modern language features like destructuring, spread operators, template literals, optional chaining, nullish coalescing, and arrow functions. You can write synchronous code with loops, conditionals, and object manipulation. You have access to standard built-in objects like Object, Array, Map, Set, and Date. You can write helper functions and organize your logic in ways that feel natural to JavaScript developers.

However, several significant limitations exist. Async/await is not supported—you cannot use async functions or await keywords. This means you cannot directly await promises or make external HTTP calls from within your resolver logic. External modules are completely unavailable; you cannot require or import libraries from npm. The execution context is sandboxed, which means no access to the file system, no ability to make direct HTTP requests, and no access to environment variables through the standard process object. Each resolver execution has a memory and execution time limit, and while these are generous for simple transformations, they're not unlimited.

The thing that trips up most developers is the no-async restriction. If you're accustomed to writing modern JavaScript with async/await, it can feel like going backward. But here's the important perspective shift: these resolvers are meant for *transformation logic*, not for orchestration. If you need to make external HTTP calls, use a Lambda data source. If you need complex async orchestration, that's exactly what Lambda is for. JavaScript resolvers excel at the parts of your resolver that would previously have been VTL boilerplate—request building, response parsing, conditional logic, and data validation.

### The Request and Response Handler Signatures

When you write a JavaScript resolver in AppSync, your code is structured around two handler functions: the request handler and the response handler. Understanding these signatures is fundamental to writing effective resolvers.

The request handler runs before AppSync sends the request to your data source. Its signature is:

```javascript
export function request(ctx) {
  // transformation logic here
  return {/* final request object */};
}
```

The `ctx` parameter is your connection to everything AppSync knows about the current request. It contains `ctx.arguments` (the arguments passed to your GraphQL field), `ctx.identity` (information about the requester for authorization), `ctx.source` (the parent object, if this is a nested field), `ctx.request` (metadata about the GraphQL request itself), and various other properties. The request handler must return an object that represents the resource-specific request—for DynamoDB, this would be a DynamoDB operation; for a Lambda invocation, it's the payload to send; for an HTTP data source, it's the request details.

The response handler runs after AppSync receives the response from your data source. Its signature is:

```javascript
export function response(ctx) {
  // transformation logic here
  return {/* transformed response */};
}
```

Here, `ctx.result` contains the raw response from your data source. Your response handler processes that result and returns the shape expected by your GraphQL schema. The `ctx` object is the same as in the request handler, so you have access to all the context information if you need it.

For pipeline resolvers (which we'll look at in more detail later), you also have access to `ctx.prev.result`, which contains the output from the previous resolver in the pipeline.

### Comparing VTL and JavaScript Resolvers Side by Side

Let's look at some practical examples that illustrate how these two approaches differ. A good starting point is a simple DynamoDB query.

In VTL, your request mapping template for fetching a user by ID might look like:

```velocity
{
  "version": "2018-05-29",
  "operation": "GetItem",
  "key": {
    "id": {
      "S": "$ctx.arguments.id"
    }
  }
}
```

And your response template:

```velocity
#if($ctx.result)
  $util.toJson($ctx.result)
#else
  null
#end
```

The same resolver in JavaScript looks like:

```javascript
export function request(ctx) {
  return {
    operation: "GetItem",
    key: {
      id: ctx.util.dynamodb.toDynamodb(ctx.arguments.id)
    }
  };
}

export function response(ctx) {
  return ctx.result ? ctx.util.dynamodb.fromDynamodb(ctx.result) : null;
}
```

At first glance, they're roughly equivalent in complexity. But notice something important: the JavaScript version is more explicit and doesn't require you to understand VTL's syntax for conditionals or JSON escaping. The code reads almost exactly like what you'd write to handle this data transformation in any JavaScript context.

Let's try something slightly more complex. Imagine you're querying DynamoDB with a filter condition based on request arguments:

VTL version:

```velocity
#set($keys = $util.parseJson($util.dynamodb.toJSON($ctx.arguments.keys)))
#set($filterExpression = "attribute_exists(#status) AND #status = :status")
#set($expressionAttributeValues = {
  ":status": { "S": "$ctx.arguments.status" }
})
#set($expressionAttributeNames = {
  "#status": "status"
})

{
  "version": "2018-05-29",
  "operation": "Query",
  "index": "statusIndex",
  "query": {
    "expression": "pk = :pk AND begins_with(sk, :sk)",
    "expressionAttributeValues": {
      ":pk": { "S": "$ctx.arguments.pk" },
      ":sk": { "S": "$ctx.arguments.skPrefix" }
    }
  },
  "filter": {
    "expression": "$filterExpression",
    "expressionAttributeNames": $util.toJson($expressionAttributeNames),
    "expressionAttributeValues": $util.toJson($expressionAttributeValues)
  }
}
```

JavaScript version:

```javascript
export function request(ctx) {
  const { pk, skPrefix, status } = ctx.arguments;
  
  return {
    operation: "Query",
    index: "statusIndex",
    query: {
      expression: "pk = :pk AND begins_with(sk, :sk)",
      expressionAttributeValues: {
        ":pk": pk,
        ":sk": skPrefix
      }
    },
    filter: {
      expression: "attribute_exists(#status) AND #status = :status",
      expressionAttributeNames: {
        "#status": "status"
      },
      expressionAttributeValues: {
        ":status": status
      }
    }
  };
}

export function response(ctx) {
  return ctx.result.items || [];
}
```

The difference becomes apparent: JavaScript resolvers don't require you to manually construct JSON or worry about type conversions. You write destructuring to extract what you need, build your objects naturally, and let AppSync handle the serialization. The mental model is simpler because it's just JavaScript.

### Common Migration Patterns from VTL to JavaScript

If you have an existing AppSync API built with VTL, the migration path to JavaScript is straightforward, though it requires careful planning. Rather than attempting a risky all-at-once migration, a gradual approach works better: migrate resolvers incrementally, test thoroughly at each step, and keep VTL resolvers you're confident in until you're ready to move them.

The first step is to identify which resolvers are good candidates to migrate. Resolvers with complex conditional logic are great candidates because JavaScript makes that logic more readable. Simple pass-through resolvers that mostly just format the request or response are also quick wins. VTL resolvers that include error handling or custom authorization logic benefit significantly from JavaScript's clearer syntax.

For any VTL resolver you're migrating, start by understanding exactly what it's doing. VTL can be subtle—the use of `#set` variables, the implicit string conversions, the utility functions like `$util.dynamodb.toDynamodb()`. Map out the flow: what does the request handler do? What does the response handler do? Are there any error conditions it handles? Once you understand the intent, write the JavaScript version with that same intent but using JavaScript idioms.

Here's a concrete migration example. Suppose you have a VTL resolver that creates a DynamoDB item with a timestamp:

```velocity
#set($item = $ctx.arguments.input)
#set($item.createdAt = $util.time.nowISO8601())
#set($item.id = $util.autoId())

{
  "version": "2018-05-29",
  "operation": "PutItem",
  "key": {
    "id": {
      "S": "$item.id"
    }
  },
  "attributeValues": $util.dynamodb.toJson($item)
}
```

Migrated to JavaScript:

```javascript
export function request(ctx) {
  const { input } = ctx.arguments;
  const id = ctx.util.autoId();
  
  const item = {
    ...input,
    id,
    createdAt: new Date().toISOString()
  };
  
  return {
    operation: "PutItem",
    key: {
      id
    },
    attributeValues: item
  };
}

export function response(ctx) {
  return ctx.util.dynamodb.fromDynamodb(ctx.result);
}
```

Notice the structural similarity—you're doing the same operations, but the JavaScript version uses spread operators and Date objects instead of VTL syntax. The logic is more immediately clear to a JavaScript developer.

### Pipeline Resolvers and Multi-Step Transformations

One of AppSync's most powerful features is pipeline resolvers, which chain multiple resolver functions together. Each function in the pipeline can transform the context, call a data source, and pass its result to the next function. This is where JavaScript resolvers really shine, because the syntax for building complex pipelines becomes much clearer.

A pipeline resolver doesn't directly specify a data source. Instead, it chains together multiple resolver functions called "pipeline functions." Each function has a request and response handler, and the `ctx` object carries state through the pipeline.

Consider a scenario where you need to check user authorization, fetch user data from DynamoDB, then fetch related posts for that user. In VTL, you'd write three separate resolvers with careful attention to how the context flows through them. In JavaScript, the same pattern is more explicit and easier to follow:

```javascript
// First pipeline function: Validate user authorization
export function request(ctx) {
  // Validate that the current user has permission to view this data
  if (!ctx.identity.userArn) {
    throw new Error("Unauthorized");
  }
  
  // Return a marker that says "skip this step, move to next"
  return {};
}

export function response(ctx) {
  // Pass the user ID to the next function
  return ctx.identity.userArn;
}
```

```javascript
// Second pipeline function: Get user data from DynamoDB
export function request(ctx) {
  return {
    operation: "GetItem",
    key: {
      id: ctx.prev.result // Result from previous function
    }
  };
}

export function response(ctx) {
  return ctx.result; // The user item
}
```

```javascript
// Third pipeline function: Get user's posts from DynamoDB
export function request(ctx) {
  const userData = ctx.prev.result;
  
  return {
    operation: "Query",
    index: "userIdIndex",
    query: {
      expression: "userId = :userId",
      expressionAttributeValues: {
        ":userId": userData.id
      }
    }
  };
}

export function response(ctx) {
  return {
    ...ctx.prev.result, // User data from previous function
    posts: ctx.result.items // Posts from this function
  };
}
```

This pipeline approach makes the data flow explicit and testable. Each function has a single responsibility, and you can easily see how data flows from one step to the next. In VTL, the equivalent pipeline would require more careful management of the context object and would be harder to follow.

### Error Handling and Validation

Error handling is an area where JavaScript resolvers offer significant advantages over VTL. In VTL, you often work around errors using utility functions. In JavaScript, you can throw errors naturally, and AppSync will handle them appropriately—returning them to the client as GraphQL errors.

Here's a pattern for input validation:

```javascript
export function request(ctx) {
  const { email, age } = ctx.arguments.input;
  
  if (!email || !email.includes("@")) {
    throw new Error("Invalid email format");
  }
  
  if (age < 0 || age > 150) {
    throw new Error("Age must be between 0 and 150");
  }
  
  return {
    operation: "PutItem",
    key: { id: ctx.util.autoId() },
    attributeValues: { email, age }
  };
}

export function response(ctx) {
  return ctx.result;
}
```

When an error is thrown, AppSync captures it and returns it as a GraphQL error to the client. This is much cleaner than the VTL alternative, which would require using `$util.error()` and careful context management.

You can also handle errors from your data source in the response handler:

```javascript
export function response(ctx) {
  if (ctx.error) {
    throw new Error(`Data source error: ${ctx.error.message}`);
  }
  
  return ctx.result;
}
```

### Authorization and Identity Context

AppSync provides identity information through `ctx.identity`, which changes depending on your authorization method. In JavaScript resolvers, you can access and validate this identity cleanly.

For example, if you're using API keys (useful for development and public APIs):

```javascript
export function request(ctx) {
  // API key auth doesn't provide user identity
  // Use for public, non-sensitive data only
  return { operation: "Query", /* ... */ };
}
```

With Amazon Cognito:

```javascript
export function request(ctx) {
  const userId = ctx.identity.sub; // Cognito subject (unique user ID)
  const groups = ctx.identity.cognito.groups || []; // User's Cognito groups
  
  // Restrict query to current user's data
  return {
    operation: "Query",
    query: {
      expression: "userId = :userId",
      expressionAttributeValues: { ":userId": userId }
    }
  };
}
```

With AWS IAM:

```javascript
export function request(ctx) {
  const accountId = ctx.identity.accountId;
  const arn = ctx.identity.userArn;
  
  // Validate that this is an allowed account
  const allowedAccounts = ["123456789012"];
  if (!allowedAccounts.includes(accountId)) {
    throw new Error("Account not authorized");
  }
  
  return { /* ... */ };
}
```

The JavaScript approach makes these authorization checks feel like normal conditional logic rather than VTL template magic.

### Performance Characteristics and Runtime Behavior

One important question developers ask: how do JavaScript resolvers perform compared to VTL? The honest answer is that for most workloads, you won't notice a significant difference. Both execute in AppSync's native runtime, and both are optimized for this specific task.

However, there are some nuances worth understanding. JavaScript resolvers have slightly higher startup overhead than VTL templates due to the need to parse and validate the JavaScript code. For resolvers that are called very frequently (millions of times), this can add up. But we're talking about milliseconds per million invocations—only relevant if you're operating at massive scale and have profiled your resolvers to identify JavaScript as the bottleneck.

The cold start behavior is similar between the two. If an AppSync GraphQL endpoint receives traffic after being idle, the first few requests might see slightly elevated latency. This is not significantly different between VTL and JavaScript.

Where JavaScript potentially wins is in code clarity and maintainability. Code that's easier to understand is code that's easier to optimize. If your JavaScript resolver includes a complex conditional that someone could simplify, the readability makes that optimization more likely to happen.

One scenario where you should still prefer Lambda data sources over JavaScript resolvers is when you need async operations. If your resolver needs to make multiple external API calls, process them asynchronously, or do complex async orchestration, a Lambda function is the right tool. JavaScript resolvers simply can't do this—no async/await means no direct external I/O.

### Tooling and Local Development

Developing AppSync resolvers locally requires special tooling because both VTL and JavaScript resolvers need access to the AppSync execution context that you don't have outside of AWS.

The AWS Amplify local testing tools (part of the Amplify CLI) provide a local environment for testing AppSync GraphQL APIs. You can define your schema, write resolvers, and test them locally before deploying to AWS. For JavaScript resolvers, the experience is relatively smooth—you write .js files in your project, and the local environment executes them similarly to how AWS would.

Here's how you'd structure a local project:

```
my-api/
├── schema.graphql
├── resolvers/
│   ├── Query.getUser.js
│   ├── Query.listUsers.js
│   ├── Mutation.createUser.js
│   └── User.posts.js
└── amplify.yml
```

Each resolver file exports `request` and `response` functions, and the local environment simulates the `ctx` parameter. This lets you test your resolvers with actual GraphQL queries before deploying.

For unit testing, you can manually test your request and response functions by creating mock context objects:

```javascript
import { request, response } from "./Query.getUser.js";

const mockCtx = {
  arguments: { id: "user-123" },
  identity: { userArn: "arn:aws:iam::123456789012:user/testuser" },
  util: {
    dynamodb: {
      toDynamodb: (val) => val,
      fromDynamodb: (val) => val
    },
    autoId: () => "generated-id-123"
  },
  error: null,
  result: { id: "user-123", name: "Test User" }
};

const requestResult = request(mockCtx);
console.log(requestResult);

const responseResult = response(mockCtx);
console.log(responseResult);
```

This approach lets you test your resolver logic in isolation without deploying to AWS. It's much more practical than testing VTL templates locally, where you need to understand VTL syntax deeply to write useful tests.

For IDE support, any JavaScript editor will give you better autocomplete and error detection with JavaScript resolvers than with VTL templates. If you use TypeScript, you can even write type-safe resolvers:

```typescript
interface RequestContext {
  arguments: Record<string, any>;
  identity: Record<string, any>;
  util: {
    dynamodb: {
      toDynamodb: (val: any) => any;
      fromDynamodb: (val: any) => any;
    };
    autoId: () => string;
  };
  // ... other properties
}

export function request(ctx: RequestContext) {
  // TypeScript provides autocomplete and type checking
  const userId = ctx.arguments.id; // TypeScript knows this is any, but helps catch mistakes
  return { /* ... */ };
}
```

While AppSync doesn't natively support TypeScript resolvers, you can compile your TypeScript to JavaScript as a build step, which gives you better development experience without additional runtime overhead.

### When to Use VTL vs JavaScript

Given all of this, when should you actually choose one over the other? Here's a practical decision framework.

Choose JavaScript resolvers when you're building new APIs, when your team is comfortable with JavaScript, or when your resolver logic includes significant conditional logic or data transformation. JavaScript is more readable, more testable, and requires less specialized knowledge to maintain. If your API is primarily serving web clients and your team works with JavaScript daily, JavaScript resolvers will feel natural.

Choose VTL when you have existing resolvers that are already well-optimized and stable, when your team has deep VTL expertise, or when your resolvers are very simple and you want to minimize any potential overhead (though the difference is negligible in practice). You might also prefer VTL if you're deeply embedded in the Velocity ecosystem for other AWS services and want consistency.

In practice, you can mix both approaches in a single API. Some resolvers can be JavaScript and others VTL. This is useful during migration—you can gradually move to JavaScript without rewriting everything at once. AppSync handles the mix seamlessly, and the performance characteristics are comparable.

### Limitations to Remember

As you adopt JavaScript resolvers, keep these constraints in mind because they'll determine whether JavaScript is the right tool for a given resolver.

No async/await and no promises means you cannot directly call external services from your resolver. You need to use Lambda data sources or HTTP data sources that AppSync calls synchronously. This is actually a good constraint because it forces you to keep your resolvers focused on transformation rather than orchestration.

No external modules means you cannot import lodash, moment, or any npm package. You can write helper functions in your resolver files, and you can inline simple utility functions, but you cannot depend on external libraries. This encourages writing lightweight, focused resolvers.

No file system access, no environment variable access through `process.env`, and no direct HTTP calls mean your resolver is entirely sandboxed. To access environment variables, AppSync provides them through a different mechanism (as part of the GraphQL API configuration), and to make external calls, you use Lambda or HTTP data sources.

The execution environment has memory and time limits. While these are generous for transformation logic, they're limited. If your resolver logic approaches those limits, you should probably move the complexity to a Lambda function instead.

### Practical Migration Checklist

If you're planning to migrate existing VTL resolvers to JavaScript, use this checklist to stay organized:

Audit your existing resolvers and list them by complexity. Identify which ones are simple enough to migrate first and which ones are complex enough that they might benefit from remaining as VTL until you're more comfortable.

For each resolver you're migrating, document its current behavior thoroughly. What does it do in the request handler? What does it do in the response handler? Are there edge cases or error conditions?

Write your JavaScript resolver following the patterns outlined earlier. Use destructuring to extract what you need from the context, write conditional logic clearly, and return the expected structure.

Test your new resolver extensively in a local environment using mock contexts before deploying. Write multiple test cases covering normal operation, edge cases, and error conditions.

Deploy your new resolver to a staging environment and run your integration tests against it. Compare the behavior to your VTL version to ensure they're equivalent.

Once you're confident, deploy to production. Monitor the metrics for that resolver for a day or two to ensure it's behaving as expected. AppSync provides CloudWatch metrics for resolver performance.

After successful deployment, archive your old VTL resolver code (you might need to reference it later) and consider whether similar patterns in other resolvers could be migrated using the same approach.

### Looking Forward

JavaScript resolvers represent AppSync's evolution toward more developer-friendly tooling. The trend in AWS services is toward reducing friction for developers—making it easier to write, test, and maintain code. JavaScript resolvers align with that trend.

That said, VTL isn't going anywhere. AWS maintains VTL support in AppSync, and existing VTL resolvers continue to work perfectly. Migration is optional and should be driven by your team's preferences and your API's needs.

As you work with JavaScript resolvers, you'll find that their constraints—the lack of async/await, no external modules, the sandboxed environment—are actually features. They encourage a specific resolver pattern: lightweight transformation and validation, with actual business logic and external service calls delegated to Lambda or specialized data sources. This separation of concerns leads to more maintainable APIs.

The migration from VTL to JavaScript isn't a forced march; it's an optional modernization that makes sense when your team values code clarity and JavaScript familiarity over specialized template syntax. Whether you choose to migrate your entire API, gradually modernize it, or keep VTL where it works well, AppSync gives you the flexibility to choose what works for your specific context.
