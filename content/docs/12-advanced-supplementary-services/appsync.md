---
title: "40. AppSync"
type: docs
weight: 3
---

## AppSync

Modern applications often need to fetch data from multiple sources, support real-time updates, and work offline on mobile devices. Building all of this with REST APIs means writing a lot of custom glue code — separate endpoints, multiple round trips, and hand-rolled WebSocket logic. AWS AppSync [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/what-is-appsync.html) solves this by providing a managed GraphQL API layer that connects directly to your data sources, handles real-time subscriptions over WebSocket, and supports offline data sync out of the box.

### GraphQL Fundamentals

GraphQL [🔗](https://graphql.org/learn/) is a query language for APIs where the client specifies exactly the shape of the data it needs. A single request can fetch nested, related data in one round trip — no over-fetching or under-fetching. AppSync builds on three core GraphQL operations:

- **Query** — read data (equivalent to GET)
- **Mutation** — write or modify data (equivalent to POST/PUT/DELETE)
- **Subscription** — subscribe to real-time events triggered by mutations

Everything in an AppSync API is defined by a **schema** written in the GraphQL Schema Definition Language (SDL). The schema declares your types, the fields on each type, and which queries/mutations/subscriptions are available. AppSync uses this schema as the contract between client and server. [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/designing-your-schema.html)

### Data Sources

AppSync doesn't execute business logic itself — it delegates to **data sources** [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/attaching-a-data-source.html). Each field resolver in your schema maps to one of the following:

- **DynamoDB** — the most common choice; AppSync can read/write tables directly without a Lambda in the middle
- **Lambda** — for arbitrary logic, external APIs, or computations that don't fit other source types
- **RDS (Aurora Serverless v1)** — SQL queries via the RDS Data API
- **HTTP** — any public or VPC-accessible HTTP endpoint
- **OpenSearch Service** — full-text search queries
- **None** — used for local resolvers, typically to trigger subscriptions without persisting data

### Resolvers

A **resolver** connects a GraphQL field to a data source. When a client calls a query or mutation, AppSync runs the associated resolver to fetch or write data. There are two resolver types [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-components.html):

- **Unit resolver** — a single request/response mapping that talks to one data source. Simple and sufficient for most cases.
- **Pipeline resolver** — chains multiple **functions** in sequence, each calling a (potentially different) data source. Useful when a single field needs to, say, authorize a user against DynamoDB and then fetch records from a different table.

Each resolver (or pipeline function) is defined by two **VTL mapping templates** [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-mapping-template-reference.html) — a request template that transforms the incoming GraphQL arguments into a data source request, and a response template that transforms the result back into GraphQL. VTL (Apache Velocity Template Language) is a lightweight templating language. For example, a DynamoDB `GetItem` request template looks like:

```vtl
{
  "version": "2018-05-29",
  "operation": "GetItem",
  "key": {
    "id": $util.dynamodb.toDynamoDBJson($ctx.args.id)
  }
}
```

AppSync also supports **JavaScript resolvers** [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-reference-overview-js.html) as a modern alternative to VTL, allowing you to write resolver logic in a subset of JavaScript (APPSYNC_JS runtime) — cleaner and easier to reason about for most developers.

### Real-Time Subscriptions

AppSync subscriptions give clients the ability to receive live updates over a managed WebSocket connection [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/real-time-data.html). You define a subscription in the schema and link it to a mutation — whenever that mutation fires, all subscribed clients receive the updated data automatically.

```graphql
type Subscription {
  onMessageAdded(channelId: ID!): Message
    @aws_subscribe(mutations: ["addMessage"])
}
```

This is ideal for chat applications, live dashboards, collaborative tools, or any feature where pushing updates to clients is preferable to polling.

### Authorization Modes

AppSync supports five authorization modes [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/security-authz.html), and you can enable multiple simultaneously on a single API — useful when both unauthenticated users and authenticated users need access to overlapping but different data:

- **API Key** — simple, time-limited key; suited for public read-only data or development/testing
- **AWS IAM** — for AWS services or backend systems making requests with IAM credentials; uses SigV4 signing
- **Amazon Cognito User Pools** — for end-user authentication; resolvers can inspect the user's identity and group memberships via `$ctx.identity`
- **Lambda** — a custom Lambda function evaluates each request and returns an authorization decision; maximum flexibility for complex logic
- **OIDC** — for third-party identity providers that issue standard JWT tokens

You designate one mode as the **default** and can apply additional modes per field using `@aws_auth` directives in the schema.

### Caching

AppSync server-side caching [🔗](https://docs.aws.amazon.com/appsync/latest/devguide/enabling-caching.html) lets you cache resolver responses at the API level using an ElastiCache (Redis) instance provisioned by AppSync. You configure a TTL and choose between per-resolver caching (caches individual field results by resolver arguments) or full-request caching (caches the entire query response by the full request parameters including headers). This reduces load on downstream data sources and cuts latency for repeated identical queries — valuable for public APIs or high-read workloads where data doesn't change frequently.

{{< qcm >}}
[
{
"question": "A developer is building a mobile application that needs to fetch user profile data and their recent orders in a single network request, without retrieving unnecessary fields. Which AWS service is best suited for this use case?",
"answers": [
{
"answer": "Amazon API Gateway with REST APIs",
"isCorrect": false,
"explanation": "REST APIs typically require multiple endpoints and round trips to fetch related data, and they return fixed response shapes — leading to over-fetching or under-fetching."
},
{
"answer": "AWS AppSync",
"isCorrect": true,
"explanation": "AppSync provides a managed GraphQL API layer that allows clients to specify exactly the fields they need and fetch nested, related data in a single round trip — eliminating over-fetching and under-fetching."
},
{
"answer": "AWS Lambda with Amazon SQS",
"isCorrect": false,
"explanation": "SQS is a messaging queue service, not suited for synchronous data fetching. Lambda alone still requires custom API logic to aggregate data from multiple sources."
},
{
"answer": "Amazon DynamoDB Streams",
"isCorrect": false,
"explanation": "DynamoDB Streams is used to react to data changes in DynamoDB tables, not to serve client queries with flexible data shapes."
}
]
},
{
"question": "In AWS AppSync, what are the three core GraphQL operation types available to clients? (Select THREE)",
"answers": [
{
"answer": "Query",
"isCorrect": true,
"explanation": "A Query is used to read data, equivalent to an HTTP GET operation."
},
{
"answer": "Mutation",
"isCorrect": true,
"explanation": "A Mutation is used to write or modify data, equivalent to HTTP POST/PUT/DELETE operations."
},
{
"answer": "Subscription",
"isCorrect": true,
"explanation": "A Subscription allows clients to receive real-time updates over WebSocket whenever a linked mutation fires."
},
{
"answer": "Transaction",
"isCorrect": false,
"explanation": "Transaction is not a GraphQL operation type. GraphQL does not natively define a Transaction operation."
},
{
"answer": "Stream",
"isCorrect": false,
"explanation": "Stream is not a core GraphQL operation type. Real-time data delivery is handled through Subscriptions in GraphQL."
}
]
},
{
"question": "A company uses AWS AppSync and wants to implement a resolver that first checks user permissions in one DynamoDB table, and then fetches records from a different DynamoDB table — all within a single field resolution. Which resolver type should they use?",
"answers": [
{
"answer": "Unit resolver",
"isCorrect": false,
"explanation": "A unit resolver maps a single field to a single data source. It cannot chain multiple data source calls in sequence."
},
{
"answer": "Pipeline resolver",
"isCorrect": true,
"explanation": "A pipeline resolver chains multiple functions in sequence, each capable of calling a different data source. This is ideal for multi-step operations like authorization followed by data retrieval."
},
{
"answer": "Lambda resolver",
"isCorrect": false,
"explanation": "While you could use Lambda as a data source, 'Lambda resolver' is not a distinct resolver type in AppSync. The two resolver types are unit and pipeline."
},
{
"answer": "HTTP resolver",
"isCorrect": false,
"explanation": "HTTP is a data source type in AppSync, not a resolver type. It also only connects to a single HTTP endpoint per resolver invocation."
}
]
},
{
"question": "Which AppSync data source type should a developer use when they need to trigger a subscription without persisting any data to a backend store?",
"answers": [
{
"answer": "Lambda",
"isCorrect": false,
"explanation": "Lambda is used for arbitrary business logic or external API calls. Using it just to trigger a subscription without persisting data adds unnecessary overhead."
},
{
"answer": "DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is used when data needs to be read or written to a DynamoDB table. It is not appropriate when no data persistence is required."
},
{
"answer": "None",
"isCorrect": true,
"explanation": "The 'None' data source type is used for local resolvers, typically to trigger subscriptions without persisting data to any backend."
},
{
"answer": "HTTP",
"isCorrect": false,
"explanation": "The HTTP data source is used to call external HTTP endpoints. It is not suited for local, in-memory operations like triggering subscriptions without data persistence."
}
]
},
{
"question": "A developer is writing an AppSync resolver using VTL (Velocity Template Language). In the request mapping template, which context object is used to access the GraphQL arguments passed by the client?",
"answers": [
{
"answer": "$ctx.identity",
"isCorrect": false,
"explanation": "$ctx.identity contains information about the caller's identity (e.g., Cognito user attributes), not the GraphQL arguments."
},
{
"answer": "$ctx.args",
"isCorrect": true,
"explanation": "$ctx.args holds the GraphQL arguments provided by the client in the query or mutation, and is the correct object to reference in request mapping templates."
},
{
"answer": "$ctx.result",
"isCorrect": false,
"explanation": "$ctx.result contains the result returned by the data source, and is typically used in the response mapping template, not the request template."
},
{
"answer": "$ctx.request",
"isCorrect": false,
"explanation": "$ctx.request contains metadata about the incoming HTTP request (e.g., headers), not the GraphQL field arguments."
}
]
},
{
"question": "A team wants to modernize their AppSync resolvers and avoid writing VTL templates. Which alternative does AppSync support for writing resolver logic?",
"answers": [
{
"answer": "Python scripts",
"isCorrect": false,
"explanation": "AppSync does not support Python for resolver logic. Python is supported in AWS Lambda, but not as a native AppSync resolver runtime."
},
{
"answer": "JavaScript resolvers using the APPSYNC_JS runtime",
"isCorrect": true,
"explanation": "AppSync supports JavaScript resolvers as a modern alternative to VTL. Developers write resolver logic in a subset of JavaScript using the APPSYNC_JS runtime."
},
{
"answer": "TypeScript resolvers compiled at deploy time",
"isCorrect": false,
"explanation": "AppSync does not natively support TypeScript as a resolver runtime. The supported alternatives are VTL and JavaScript (APPSYNC_JS)."
},
{
"answer": "SQL expressions directly in the schema",
"isCorrect": false,
"explanation": "SQL expressions cannot be embedded directly in the AppSync schema. SQL queries for Aurora Serverless are handled via resolver mapping templates, not inline in the schema definition."
}
]
},
{
"question": "An application uses AWS AppSync to power a real-time chat feature. Clients need to receive new messages instantly without polling. Which AppSync feature enables this?",
"answers": [
{
"answer": "AppSync Caching with ElastiCache",
"isCorrect": false,
"explanation": "AppSync caching improves read performance for repeated queries, but it does not push updates to clients in real time."
},
{
"answer": "GraphQL Subscriptions over WebSocket",
"isCorrect": true,
"explanation": "AppSync subscriptions allow clients to receive live updates over a managed WebSocket connection. Whenever a linked mutation fires, all subscribed clients receive the updated data automatically."
},
{
"answer": "GraphQL Mutations with long polling",
"isCorrect": false,
"explanation": "Mutations write or modify data but do not push updates to clients. Long polling is a client-side pattern not natively managed by AppSync."
},
{
"answer": "Pipeline resolvers with scheduled invocations",
"isCorrect": false,
"explanation": "Pipeline resolvers chain data source calls for a single field resolution. They are not a mechanism for pushing real-time updates to clients."
}
]
},
{
"question": "In an AppSync schema, a subscription is defined with the `@aws_subscribe` directive. What does this directive specify?",
"answers": [
{
"answer": "The IAM role that is allowed to subscribe",
"isCorrect": false,
"explanation": "Authorization is handled separately through AppSync authorization modes (IAM, Cognito, API Key, etc.), not through the @aws_subscribe directive."
},
{
"answer": "The mutation(s) that trigger the subscription",
"isCorrect": true,
"explanation": "The @aws_subscribe directive links a subscription to one or more mutations. When those mutations fire, all subscribed clients receive the updated data."
},
{
"answer": "The WebSocket endpoint URL for the subscription",
"isCorrect": false,
"explanation": "AppSync manages the WebSocket connection automatically. Developers do not specify endpoint URLs in the schema."
},
{
"answer": "The TTL for the subscription connection",
"isCorrect": false,
"explanation": "Connection TTL is not configured via the @aws_subscribe directive. Subscription connection management is handled by AppSync automatically."
}
]
},
{
"question": "A developer needs to secure an AWS AppSync API so that only authenticated end-users (managed in a user directory) can access it, and resolvers can differentiate behavior based on a user's group membership. Which authorization mode should they use?",
"answers": [
{
"answer": "API Key",
"isCorrect": false,
"explanation": "API Key authorization is a simple time-limited key suitable for public or unauthenticated access. It does not support per-user identity or group-based logic."
},
{
"answer": "AWS IAM",
"isCorrect": false,
"explanation": "IAM authorization is best suited for AWS services or backend systems using SigV4 signing. It does not natively provide end-user identity or group membership context."
},
{
"answer": "Amazon Cognito User Pools",
"isCorrect": true,
"explanation": "Cognito User Pools authorization allows resolvers to inspect the authenticated user's identity and group memberships via $ctx.identity, making it ideal for end-user authentication with group-based access control."
},
{
"answer": "OIDC",
"isCorrect": false,
"explanation": "OIDC supports third-party identity providers that issue JWT tokens, but the question specifies a managed user directory — Cognito User Pools is the more appropriate and native AWS solution."
}
]
},
{
"question": "A company has an AppSync API that serves both public (unauthenticated) users and authenticated employees, with some fields accessible only to employees. Which AppSync capability supports this requirement?",
"answers": [
{
"answer": "Defining separate AppSync APIs for each user group",
"isCorrect": false,
"explanation": "While possible, this approach is operationally complex and unnecessary. AppSync natively supports multiple simultaneous authorization modes on a single API."
},
{
"answer": "Enabling multiple authorization modes on a single API and applying them per field with directives",
"isCorrect": true,
"explanation": "AppSync allows multiple authorization modes to be enabled simultaneously on a single API. You designate a default mode and use @aws_auth directives to apply additional modes at the field level."
},
{
"answer": "Using a Lambda resolver to manually validate every request",
"isCorrect": false,
"explanation": "Lambda authorization is one available mode, but combining modes at the field level via directives is a cleaner and more scalable solution than routing all requests through a Lambda."
},
{
"answer": "Configuring API Gateway to route requests before they reach AppSync",
"isCorrect": false,
"explanation": "AppSync handles authorization natively without requiring API Gateway as a front-end proxy."
}
]
},
{
"question": "An AppSync API uses Lambda as its authorization mode. What does the Lambda authorizer return to AppSync?",
"answers": [
{
"answer": "A JWT token that AppSync validates against Cognito",
"isCorrect": false,
"explanation": "JWT validation against Cognito is the behavior of the Cognito User Pools or OIDC authorization modes, not Lambda authorization."
},
{
"answer": "An authorization decision that AppSync uses to allow or deny the request",
"isCorrect": true,
"explanation": "With Lambda authorization, a custom Lambda function evaluates each incoming request and returns an authorization decision. This provides maximum flexibility for complex authorization logic."
},
{
"answer": "An IAM policy document with SigV4 credentials",
"isCorrect": false,
"explanation": "SigV4 signing is the mechanism used by AWS IAM authorization, not Lambda authorization."
},
{
"answer": "A GraphQL schema fragment defining allowed fields",
"isCorrect": false,
"explanation": "The Lambda authorizer returns an authorization decision (allow/deny), not a schema fragment. Field-level access is controlled via schema directives."
}
]
},
{
"question": "A team wants to reduce latency and backend load for an AppSync API that serves frequently repeated read queries on data that changes infrequently. Which AppSync feature should they enable?",
"answers": [
{
"answer": "Pipeline resolvers",
"isCorrect": false,
"explanation": "Pipeline resolvers help orchestrate multi-step data fetching but do not cache responses. They do not reduce backend load for repeated identical queries."
},
{
"answer": "AppSync server-side caching",
"isCorrect": true,
"explanation": "AppSync server-side caching uses an ElastiCache (Redis) instance to cache resolver responses, reducing load on downstream data sources and cutting latency for repeated identical queries — ideal for high-read workloads with infrequently changing data."
},
{
"answer": "GraphQL Subscriptions",
"isCorrect": false,
"explanation": "Subscriptions push real-time updates to clients. They do not cache query responses or reduce load for repeated read queries."
},
{
"answer": "DynamoDB DAX",
"isCorrect": false,
"explanation": "DAX is a caching layer for DynamoDB and operates at the DynamoDB level. AppSync's own server-side caching is the appropriate feature for caching at the API/resolver level."
}
]
},
{
"question": "When configuring AppSync server-side caching, a developer must choose between two caching strategies. What are the two available options? (Select TWO)",
"answers": [
{
"answer": "Per-resolver caching",
"isCorrect": true,
"explanation": "Per-resolver caching caches the response of individual field resolvers, keyed by the resolver's arguments. It provides fine-grained cache control."
},
{
"answer": "Full-request caching",
"isCorrect": true,
"explanation": "Full-request caching caches the entire query response, keyed by the full request parameters including headers. It offers coarser-grained but broader caching."
},
{
"answer": "Per-subscription caching",
"isCorrect": false,
"explanation": "Subscriptions are for real-time updates and do not have an associated caching strategy in AppSync."
},
{
"answer": "Schema-level caching",
"isCorrect": false,
"explanation": "Schema-level caching is not a caching strategy offered by AppSync. Caching operates at the resolver or full-request level."
}
]
},
{
"question": "A developer is designing an AppSync API where some fields require running SQL queries against an Amazon Aurora database. Which data source type should be configured for those resolvers?",
"answers": [
{
"answer": "DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is a NoSQL data source in AppSync. SQL queries against Aurora require a different data source type."
},
{
"answer": "RDS (Aurora Serverless v1) via the RDS Data API",
"isCorrect": true,
"explanation": "AppSync supports RDS (Aurora Serverless v1) as a data source, enabling SQL queries through the RDS Data API directly from resolvers."
},
{
"answer": "HTTP data source pointing to an RDS proxy",
"isCorrect": false,
"explanation": "While technically possible, using an HTTP data source to call an RDS proxy is not the native AppSync integration for Aurora. The RDS data source using the RDS Data API is the correct approach."
},
{
"answer": "OpenSearch Service",
"isCorrect": false,
"explanation": "OpenSearch Service is used for full-text search queries, not SQL-based relational database queries."
}
]
},
{
"question": "An AppSync API needs to call an external payment provider's REST API from a resolver, without any custom business logic transformation. Which data source type is most appropriate?",
"answers": [
{
"answer": "Lambda",
"isCorrect": false,
"explanation": "Lambda could be used to call the external API, but the question specifies no custom logic is needed. Using Lambda adds unnecessary operational overhead for a simple HTTP passthrough."
},
{
"answer": "HTTP",
"isCorrect": true,
"explanation": "The HTTP data source type allows AppSync resolvers to directly call any public or VPC-accessible HTTP endpoint, making it the most appropriate choice for calling an external REST API without custom logic."
},
{
"answer": "None",
"isCorrect": false,
"explanation": "The 'None' data source is used for local resolvers that trigger subscriptions without persisting data. It cannot make outbound HTTP calls."
},
{
"answer": "OpenSearch Service",
"isCorrect": false,
"explanation": "OpenSearch Service is for full-text search workloads. It cannot route requests to an arbitrary external REST API."
}
]
},
{
"question": "A GraphQL schema in AppSync is written in which language?",
"answers": [
{
"answer": "JSON Schema",
"isCorrect": false,
"explanation": "JSON Schema is used for validating JSON documents, not for defining GraphQL APIs. AppSync schemas use the GraphQL Schema Definition Language."
},
{
"answer": "OpenAPI (Swagger)",
"isCorrect": false,
"explanation": "OpenAPI/Swagger is used for defining REST APIs. AppSync uses GraphQL SDL for schema definition."
},
{
"answer": "GraphQL Schema Definition Language (SDL)",
"isCorrect": true,
"explanation": "AppSync schemas are written in GraphQL SDL, which declares types, fields, queries, mutations, and subscriptions — forming the contract between the client and the API."
},
{
"answer": "Apache Velocity Template Language (VTL)",
"isCorrect": false,
"explanation": "VTL is used for writing resolver mapping templates in AppSync, not for defining the GraphQL schema itself."
}
]
}
]
{{< /qcm >}}