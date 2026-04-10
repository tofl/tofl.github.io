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