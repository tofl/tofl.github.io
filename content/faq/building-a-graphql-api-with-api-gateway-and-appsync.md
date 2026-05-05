---
title: "Building a GraphQL API with API Gateway and AppSync"
---

## Building a GraphQL API with API Gateway and AppSync

GraphQL has become the go-to query language for building flexible, efficient APIs. If you're working on AWS and considering how to implement GraphQL, you've likely encountered two distinct approaches: using API Gateway with a Lambda function as your GraphQL resolver, or using AWS AppSync, which is purpose-built specifically for GraphQL workloads. Understanding when and why to choose each option is crucial for building scalable, maintainable APIs on AWS.

This article walks you through both approaches, explores their strengths and limitations, and helps you make an informed decision about which path suits your use case. Whether you're building a simple proof-of-concept or a production-grade system, knowing these tools and their trade-offs will make you a more effective AWS developer.

### Understanding the Two Paths to GraphQL on AWS

When you want to expose a GraphQL API on AWS, you have fundamentally different architectures available to you. The first involves using API Gateway—the same service primarily designed for REST and HTTP APIs—paired with a Lambda function that runs a GraphQL server library like Apollo Server or GraphQL.js. The second involves AppSync, a managed GraphQL service that AWS built from the ground up to handle GraphQL-specific features and integrations.

To understand this distinction, it helps to remember that API Gateway was originally designed to handle REST APIs and HTTP endpoints. While it's absolutely capable of forwarding GraphQL requests to a Lambda resolver, you're essentially adapting a general-purpose tool to GraphQL's specific needs. AppSync, by contrast, was created with GraphQL's data fetching patterns, subscription model, and resolver architecture in mind.

### The API Gateway with Lambda Approach

When you implement GraphQL via API Gateway and Lambda, the flow is straightforward: a client sends a GraphQL query to an HTTP endpoint managed by API Gateway, which routes the request to a Lambda function. That Lambda function runs a GraphQL server implementation—typically Apollo Server or a similar library—that parses the query, validates it against your schema, and executes resolvers to fetch data.

Let's walk through what this looks like in practice. First, you define your GraphQL schema:

```graphql
type Query {
  user(id: ID!): User
  posts: [Post!]!
}

type User {
  id: ID!
  name: String!
  email: String!
}

type Post {
  id: ID!
  title: String!
  author: User!
}
```

Then you implement an Apollo Server in your Lambda function:

```javascript
const { ApolloServer, gql } = require('apollo-server-lambda');

const typeDefs = gql`
  type Query {
    user(id: ID!): User
    posts: [Post!]!
  }
  
  type User {
    id: ID!
    name: String!
    email: String!
  }
  
  type Post {
    id: ID!
    title: String!
    author: User!
  }
`;

const resolvers = {
  Query: {
    user: async (_, { id }) => {
      // Fetch user from DynamoDB, RDS, or other source
      return await fetchUserById(id);
    },
    posts: async () => {
      return await fetchAllPosts();
    }
  },
  Post: {
    author: async (post) => {
      // Resolve the author relationship
      return await fetchUserById(post.authorId);
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers
});

exports.graphqlHandler = server.createHandler();
```

You then create an API Gateway REST endpoint that integrates with this Lambda function. When a client sends a GraphQL query to your endpoint, API Gateway invokes the Lambda, which runs your Apollo Server instance, and the response is returned.

The appeal of this approach is its familiarity and flexibility. You're using battle-tested GraphQL libraries in a language and runtime you likely already understand. You control every aspect of execution, caching, and error handling. For developers who are already comfortable with Lambda and API Gateway, this path feels natural.

However, there are real constraints worth acknowledging. Lambda's execution duration limit (currently 15 minutes) affects how long any single resolver can run. Each cold start introduces latency, which is especially noticeable in GraphQL scenarios where nested resolvers might spawn multiple Lambda invocations. There's no native support for GraphQL subscriptions—the long-lived connections that enable real-time updates. You're responsible for implementing caching strategies manually, and while you can use ElastiCache or API Gateway caching, it requires additional infrastructure and careful cache key design.

### AWS AppSync: Purpose-Built for GraphQL

AppSync takes a fundamentally different approach. Rather than treating GraphQL as just another payload format to handle in a general compute service, AppSync is a managed service specifically designed around GraphQL's execution model. When you use AppSync, you define your GraphQL schema in AppSync itself, then attach resolvers that connect your schema to data sources.

The resolver architecture in AppSync is distinctive. Instead of writing resolver code in JavaScript or Python, you use VTL (Velocity Template Language) or JavaScript, depending on your preference. These resolvers are request and response transformers that sit between your GraphQL execution engine and your actual data sources. Here's what a resolver pair looks like:

A request resolver transforms the incoming GraphQL argument into a data source request. For example, if you're querying a DynamoDB table:

```velocity
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "id": $util.dynamodb.toDynamoDBJson($ctx.arguments.id)
  }
}
```

The response resolver transforms the data source response back into your GraphQL type:

```velocity
$util.toJson($ctx.result)
```

If you prefer JavaScript, the same resolver becomes:

```javascript
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: {
      id: ctx.arguments.id
    }
  };
}

export function response(ctx) {
  return ctx.result;
}
```

This architecture may seem unusual at first—why not just write a function that fetches and returns data? The key insight is that VTL and AppSync's JavaScript resolvers are optimized for GraphQL's execution model. They're stateless, lightweight, and designed to chain together efficiently when resolving nested fields.

AppSync connects directly to AWS data sources: DynamoDB, RDS, Lambda functions, HTTP endpoints, Elasticsearch, and more. This native integration is powerful. When you attach a DynamoDB resolver to a field, AppSync understands DynamoDB's API natively and can construct requests without additional Lambda overhead. The result is lower latency and simpler infrastructure.

Real-time subscriptions are built into AppSync. If a client subscribes to updates on a particular field, AppSync manages the WebSocket connection automatically and pushes updates when mutations modify that data. This is a native GraphQL feature—not something you have to build on top of API Gateway.

AppSync also provides built-in caching at multiple levels. You can cache resolver responses, and AppSync understands GraphQL cache control directives. You can define cache keys that include GraphQL arguments, ensuring that queries with different parameters don't return stale data.

### Key Differences and Trade-offs

The decision between these two approaches depends on your specific requirements. Here are the primary considerations:

**Native GraphQL Features**: AppSync provides out-of-the-box support for subscriptions, caching, and real-time capabilities. If your application needs to push updates to clients in real-time—think collaborative editing, live dashboards, or chat applications—AppSync handles this natively. With API Gateway and Lambda, you'd need to implement subscriptions separately, typically using additional services like API Gateway's WebSocket API paired with a separate compute layer to manage connections and publish updates.

**AWS Service Integration**: AppSync's direct connectors to DynamoDB, RDS, and other AWS services eliminate the need for intermediate Lambda functions in many scenarios. This reduces latency, simplifies your infrastructure, and lowers costs. If your GraphQL API is primarily exposing data from AWS services, AppSync's integrated resolvers are significantly more efficient than Lambda-based approaches that would require you to write code to connect to those services.

**Operational Complexity**: AppSync is managed, which means AWS handles scaling, availability, and infrastructure. You focus on schema design and resolver logic. API Gateway with Lambda gives you more control but requires you to manage Lambda concurrency, cold starts, and scaling behavior. For teams with strong ops expertise, this control might be valuable. For most teams, AppSync's managed nature reduces operational overhead.

**Cost Structure**: AppSync pricing is based on the number of GraphQL requests and data transferred. Lambda pricing depends on invocations and execution duration. For high-traffic APIs where AppSync's native integrations avoid Lambda invocations, AppSync can be more cost-effective. For low-traffic or highly specialized workloads where you need maximum flexibility, Lambda might be cheaper.

**Learning Curve**: If your team is already deep in the Lambda ecosystem, the API Gateway approach leverages existing skills. AppSync requires learning VTL or AppSync's JavaScript resolver syntax, which is less familiar to most developers initially. However, this investment pays off quickly when building GraphQL-native applications.

**Customization and Control**: API Gateway with Lambda gives you complete control over execution. You can implement custom authentication, complex business logic, or unusual data fetching patterns. AppSync provides good customization through Lambda resolvers (you can invoke Lambda functions from AppSync) and HTTP data sources, but if your requirements are highly custom, pure Lambda might be simpler.

### A Practical Comparison Scenario

Let's consider a concrete example: building an API for a content management system with users, articles, and comments. Each article has an author (a user) and multiple comments, each of which also has an author.

With the API Gateway and Lambda approach, you'd write resolvers in JavaScript that fetch data from your database. When resolving an article's author field, your resolver would query the database for that user. If your query asks for 10 articles and each article's author, you'd have 11 database queries (one for articles, ten for authors). This is the N+1 problem, and you'd need to implement query batching and caching logic yourself using libraries like DataLoader.

With AppSync, you can also run into the N+1 problem, but AppSync's pipeline resolvers and batching capabilities make it easier to optimize. You can write a single resolver that batches multiple author queries into one database call. AppSync's resolver chaining also encourages you to think about data fetching in a way that naturally leads to efficient queries.

For real-time updates—say you want to push notifications to clients when new comments are added—the Lambda approach requires significant additional work. You'd need API Gateway's WebSocket API, additional compute to manage subscriptions, and logic to publish updates when mutations occur. With AppSync, subscriptions are built in: a client can subscribe to comments on an article, and AppSync automatically pushes updates when comments are added.

### When to Choose Each Approach

Use API Gateway with Lambda for GraphQL when you have complex business logic that benefits from a traditional programming language, when you're integrating with legacy systems that don't fit AppSync's data source model, or when you already have significant Lambda infrastructure and want to minimize architectural changes.

Use AppSync for GraphQL when you're building a new application, when you want native support for subscriptions and real-time features, when your data primarily lives in AWS services like DynamoDB or RDS, when you want to minimize operational overhead, or when you want to leverage AppSync's caching and batching capabilities to build efficient APIs with less custom code.

For most new GraphQL workloads on AWS, AppSync is the preferred choice. It's specifically designed for GraphQL, it integrates seamlessly with AWS services, and it handles many operational concerns automatically. The time saved avoiding custom subscription management, caching logic, and service integration code usually outweighs the learning curve of VTL or AppSync's JavaScript resolver syntax.

### Moving Forward with Your Choice

If you've decided AppSync is right for your project, the next steps involve learning schema design, understanding resolver patterns, and exploring AppSync's data sources and authorization mechanisms. AppSync supports multiple authorization strategies including API keys for development, IAM for AWS service-to-service authentication, Cognito for user authentication, and OIDC/SAML for enterprise integration.

If you're going with API Gateway and Lambda, focus on choosing a solid GraphQL library, implementing efficient resolver patterns with query batching to avoid N+1 problems, and planning your subscription strategy early if real-time features are important to your application.

### Conclusion

GraphQL on AWS offers two compelling paths. API Gateway with Lambda provides flexibility and familiarity for developers comfortable with traditional Lambda-based architectures, particularly when dealing with complex business logic or non-standard integrations. AppSync, however, is purpose-built for GraphQL and delivers significant advantages through native subscriptions, AWS service integrations, managed scaling, and built-in caching.

The choice depends on your team's expertise, your application's requirements, and your operational preferences. For greenfield GraphQL projects, AppSync's native capabilities and managed nature make it the natural starting point. For teams with deep Lambda expertise or highly specialized requirements, API Gateway remains viable. Understanding both options ensures you can make the choice confidently and build the API architecture that best serves your users and your team.
