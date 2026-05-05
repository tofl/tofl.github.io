---
title: "AppSync Pipeline Resolvers: Chaining Functions for Complex Workflows"
---

## AppSync Pipeline Resolvers: Chaining Functions for Complex Workflows

Imagine you're building a GraphQL API that needs to check user permissions before fetching data, then log the access attempt to an audit trail, and finally aggregate results from multiple sources. Doing all of that in a single resolver function gets messy fast. This is where AppSync pipeline resolvers shine. They let you break down complex operations into discrete, reusable functions that execute in sequence, passing data through a shared context as they go. If you've been writing monolithic resolver functions and wondering if there's a better way, pipeline resolvers are the answer you've been looking for.

### Understanding the Pipeline Resolver Architecture

At its core, a pipeline resolver is a way to chain multiple AppSync functions together in a specific order. Rather than writing one large mapping template that does everything, you compose several smaller, focused functions that each handle one responsibility. Each function in the pipeline gets access to the same context object, which means data flows naturally from one function to the next.

Think of it like an assembly line. The first function processes the raw request, passes its output to the second function, which processes that output and passes it along, and so on. The final output is what the client receives.

The anatomy of a pipeline resolver consists of three key components: the Before mapping template, the function list (with each function having its own before and after templates), and the After mapping template. The Before template runs once at the start, preparing the context. Then each function executes in order, and finally the After template runs once at the end to format the response.

### The Request-Response Cycle: Before, Functions, and After

When a GraphQL query hits a pipeline resolver, the execution flow is deterministic and predictable. First, the Before mapping template executes. This is your opportunity to initialize variables, set up any shared state, and prepare the context that all downstream functions will use. It's optional—if you don't need any pre-processing, you can leave it blank.

Next, each function in the pipeline executes in the order you've defined. A function consists of a request mapping template (which transforms the GraphQL arguments into a format the data source understands), a data source invocation, and a response mapping template (which transforms the result back into a shape the next function or final response expects). The output of one function's response template becomes available to the next function in the pipeline.

Finally, after all functions have executed, the After mapping template runs. This is where you shape the final response that gets returned to the client. You can clean up the context, format nested data, or perform any final transformations.

The key insight here is that every step has access to the entire request context through the `$ctx` object. This object persists throughout the entire pipeline execution, which is what makes passing data between functions possible and elegant.

### The $ctx.stash Object: Your Pipeline's Shared Memory

The `$ctx.stash` object is the mechanism that makes pipeline resolvers truly powerful. It's a map that you can read from and write to at any point in the pipeline, and its contents are available to every subsequent function. Think of it as a scratchpad that travels through the entire pipeline.

Here's a practical example. Suppose you have a function that checks user authorization and extracts the user's ID. You'd stash that user ID so downstream functions can use it without having to re-derive it:

```velocity
#set($ctx.stash.userId = $ctx.identity.claims.sub)
#set($ctx.stash.userRole = $ctx.identity.claims['custom:role'])
```

Then, in a subsequent function that needs to fetch user-specific data, you can reference those values:

```velocity
{
  "version": "2018-05-29",
  "operation": "Query",
  "query": {
    "expression": "pk = :pk AND sk = :sk",
    "expressionValues": {
      ":pk": { "S": "USER#$ctx.stash.userId" },
      ":sk": { "S": "PROFILE" }
    }
  }
}
```

The stash is mutable, so you can add to it, modify it, or even nest complex structures within it. This flexibility is what lets you build sophisticated multi-step workflows without losing information between steps.

### Common Pipeline Patterns

Several patterns emerge repeatedly when you start using pipeline resolvers. Understanding these patterns will help you design your own pipelines effectively.

#### Authorization Check Followed by Data Fetch

The most common pattern is to authorize the request first, then fetch data only if authorization succeeds. The authorization function validates that the user has the necessary permissions, and if they do, it stashes a flag indicating success. The subsequent fetch function checks this flag and only proceeds if the authorization passed.

```velocity
// Authorization function response template
#if($ctx.result.authorized == true)
  #set($ctx.stash.isAuthorized = true)
  $util.toJson({})
#else
  $util.appendError("Unauthorized")
#end

// Fetch function request template
#if(!$ctx.stash.isAuthorized)
  $util.error("Authorization check failed")
#end
// proceed with fetch...
```

This pattern is elegant because it separates concerns: the authorization logic lives in one function, the data fetching logic in another. If you need to change authorization rules, you modify only the authorization function.

#### Multi-Source Aggregation

Another common scenario is fetching data from multiple sources and combining them. Your first function might fetch user data from DynamoDB, your second function fetches related recommendations from Elasticsearch, and your third function combines them into a single response object.

```velocity
// After mapping template that aggregates results
{
  "user": $ctx.stash.userData,
  "recommendations": $ctx.stash.recommendedItems,
  "lastUpdated": $ctx.stash.lastUpdated
}
```

Each function stashes its result with a descriptive key, and the After template simply combines these stashed values into the final response structure.

#### Audit Logging

A third pattern involves auditing or logging important operations. You might have a function that performs an action (like updating a record), then a second function that logs that action to an audit table. The first function stashes details about what was done, and the second function uses those details to create an audit entry.

```velocity
// Primary function response template
#set($ctx.stash.actionType = "UPDATE")
#set($ctx.stash.recordId = $ctx.result.id)
#set($ctx.stash.timestamp = $util.time.nowISO8601())
$util.toJson($ctx.result)

// Audit function request template
{
  "version": "2018-05-29",
  "operation": "PutItem",
  "key": {
    "pk": { "S": "AUDIT#$ctx.stash.recordId" },
    "sk": { "S": "$ctx.stash.timestamp" }
  },
  "attributeValues": {
    "action": { "S": "$ctx.stash.actionType" },
    "userId": { "S": "$ctx.identity.claims.sub" }
  }
}
```

This pattern ensures that every important operation leaves a trail without cluttering your primary business logic.

### A Concrete Example: Cognito Authorization into DynamoDB Query

Let's walk through a complete, realistic example. Suppose you have a GraphQL type called `UserProfile` that should only be fetchable by the user themselves or by an admin. You'll build a pipeline resolver with two functions: one to validate authorization using Cognito claims, and one to fetch the profile from DynamoDB.

First, you'd define your AppSync functions. The authorization function doesn't need a data source—it's pure mapping template logic:

```velocity
// Authorization function request template
{
  "version": "2018-05-29"
}

// Authorization function response template
#set($requestedUserId = $ctx.args.userId)
#set($currentUserId = $ctx.identity.claims.sub)
#set($userRole = $ctx.identity.claims['custom:role'])

#if($currentUserId == $requestedUserId || $userRole == 'admin')
  #set($ctx.stash.isAuthorized = true)
  #set($ctx.stash.userId = $requestedUserId)
  $util.toJson({})
#else
  $util.appendError("You are not authorized to view this profile")
#end
```

Next, the DynamoDB fetch function:

```velocity
// DynamoDB fetch function request template
#if(!$ctx.stash.isAuthorized)
  $util.error("Authorization check failed")
#end

{
  "version": "2018-05-29",
  "operation": "GetItem",
  "key": {
    "pk": { "S": "USER#$ctx.stash.userId" },
    "sk": { "S": "PROFILE" }
  }
}

// DynamoDB fetch function response template
#if($ctx.result)
  #set($ctx.stash.profile = $ctx.result)
  $util.toJson($ctx.result)
#else
  $util.error("Profile not found")
#end
```

Finally, the After mapping template of your pipeline resolver:

```velocity
{
  "userId": $ctx.stash.profile.userId,
  "email": $ctx.stash.profile.email,
  "name": $ctx.stash.profile.name,
  "createdAt": $ctx.stash.profile.createdAt
}
```

When a query comes in requesting a user profile, the pipeline executes in order: the authorization function checks the Cognito claims and stashes the authorization result and user ID, then the DynamoDB function checks the authorization flag, fetches the profile if authorized, and stashes it, and finally the After template formats and returns the profile. If authorization fails at step one, subsequent functions can short-circuit and not execute unnecessary database operations.

### Pipeline Resolvers versus Single Lambda Functions

You might be wondering: couldn't I just invoke a single Lambda function that does everything? Technically yes, but there are important trade-offs to consider.

A monolithic Lambda function is simpler to deploy—it's one function, one code base. However, it becomes harder to test individual steps, harder to reuse authorization logic across multiple resolvers, and harder to modify one piece of business logic without affecting the others. It also makes error handling more complicated because you're mixing all your concerns together.

Pipeline resolvers, on the other hand, embrace the single-responsibility principle. Each function has one job. This makes them easier to test, debug, and maintain. You can reuse an authorization function across multiple resolvers. You can modify the data-fetching logic without touching the authorization logic. Each function is small and focused, which makes the code easier to reason about.

Additionally, pipeline resolvers give AppSync better visibility into what's happening at each step. If one function fails, you know exactly which step failed. If a function is slow, AppSync's CloudWatch metrics will tell you that. With a monolithic Lambda, that visibility is lost inside the Lambda function's execution.

There's also a performance consideration. A pipeline resolver with multiple small functions executes those functions in sequence, and AppSync can parallelize the execution of independent data source calls in ways that a sequential Lambda function cannot. Moreover, if one step in your pipeline doesn't need computation—like a pure mapping template transformation—it doesn't incur Lambda invocation overhead at all.

That said, pipeline resolvers aren't always the right choice. If your logic is truly inseparable and doesn't benefit from modularity, a Lambda function might be simpler. And if you're doing heavy computational work that spans multiple steps, a Lambda function might be more efficient than many small function invocations. The key is understanding your use case and choosing accordingly.

### Practical Considerations and Best Practices

When building pipeline resolvers, a few best practices will serve you well. First, name your functions descriptively. Instead of `function1`, `function2`, use names like `authorizeUserFunction`, `fetchUserProfileFunction`. This makes it immediately clear what each step does.

Second, keep functions focused. If a function is doing multiple things, consider splitting it into separate functions. A function that checks authorization, logs the attempt, and then validates input is doing too much. Break it into discrete steps.

Third, be intentional about what you stash. Stash the results and extracted values that downstream functions will need, but don't stash everything. A cluttered stash object becomes hard to debug. Use descriptive keys that make it obvious what data you're storing.

Fourth, handle errors gracefully at each step. Use `$util.appendError()` to add errors to the response without stopping execution, or use `$util.error()` to halt immediately. In a pipeline, an error in one function might legitimately affect downstream functions, so handle these cases explicitly.

Finally, leverage AppSync's built-in functions and utilities. The Velocity Template Language (VTL) that powers mapping templates has plenty of utility functions for common operations like JSON parsing, time formatting, and encoding. Familiarize yourself with these to keep your templates clean and expressive.

### Monitoring and Debugging Pipelines

AppSync provides CloudWatch metrics for each function in a pipeline, which is invaluable for understanding performance and reliability. You can see the execution duration of each function, error rates, and whether functions are being invoked at all.

When debugging, the CloudWatch Logs for your resolver will show you the execution flow. You can add debug logging to mapping templates using `$util.log.info()` to trace how data flows through your pipeline. This is particularly useful when the stash object gets complex or when you're trying to understand why a function isn't executing.

Another debugging technique is to temporarily modify your After template to return the entire stash object, which lets you see exactly what each function has stashed. This is invaluable for understanding what's being passed between functions and spotting unexpected data shapes.

### Conclusion

Pipeline resolvers are a powerful feature that transforms how you structure AppSync resolvers. By breaking complex operations into modular, reusable functions connected through a shared context object, you build APIs that are easier to understand, test, maintain, and extend. The pattern of authorization checks feeding into data fetches, multi-source aggregation, and audit logging are just the beginning—once you start thinking in terms of pipelines, you'll find countless places where this composable approach simplifies your code.

The key takeaway is this: pipeline resolvers aren't just about chaining functions together. They're about embracing modularity and composability in your GraphQL resolvers, which leads to cleaner code, better error handling, and APIs that grow and change gracefully as your requirements evolve. If you're building anything beyond trivial GraphQL operations, pipeline resolvers deserve to be part of your AppSync toolkit.
