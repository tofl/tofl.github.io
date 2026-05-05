---
title: "AppSync Real-Time Subscriptions: How They Work Under the Hood"
---

## AppSync Real-Time Subscriptions: How They Work Under the Hood

Building real-time features in modern applications has shifted from a luxury to an expectation. Users want instant notifications when data changes—whether they're collaborating on a document, watching a live dashboard, or chatting with friends. AWS AppSync makes this surprisingly approachable by abstracting away the complexity of real-time infrastructure. At the heart of AppSync's real-time magic lies a well-engineered subscription system that deserves deeper understanding. In this article, we'll explore how GraphQL subscriptions actually work in AppSync, demystify the transport layer, examine practical filtering strategies, and show you how to build real-time features that scale.

### Understanding GraphQL Subscriptions in AppSync

Before diving into the mechanics, let's clarify what subscriptions are and why they matter. In GraphQL, you have queries (one-shot reads), mutations (writes that return data), and subscriptions (persistent connections that push updates). A subscription establishes a lasting connection between client and server, allowing the server to proactively send data to the client whenever a triggering event occurs.

Think of it this way: if a REST API is like calling a restaurant to ask if your food is ready, a GraphQL subscription is like the restaurant calling you the moment your order comes up. The client doesn't have to keep asking—the server pushes information whenever relevant changes happen.

In AppSync, subscriptions are defined in your GraphQL schema just like queries and mutations. Here's a simple example:

```graphql
type Subscription {
  onMessageCreated: Message
  onUserStatusChanged(userId: ID!): UserStatus
}

type Message {
  id: ID!
  content: String!
  authorId: ID!
  createdAt: AWSDateTime!
}
```

When a client subscribes to `onMessageCreated`, it establishes a connection and waits. Later, when a mutation creates a new message, AppSync automatically notifies all connected subscribers. The subscriber receives the new message data in real-time.

### The MQTT-over-WebSockets Transport Layer

This is where things get interesting. AppSync doesn't use plain WebSockets for subscriptions—it implements a more sophisticated system built on MQTT (Message Queuing Telemetry Transport) layered over WebSockets. Understanding this architecture helps explain both AppSync's strengths and its limitations.

MQTT is a publish-subscribe protocol originally designed for lightweight IoT communication. It's message-oriented rather than connection-oriented, which makes it ideal for real-time scenarios. When AppSync combines MQTT with WebSockets, it gets the benefits of both: a standardized, proven pub-sub pattern over a web-friendly transport protocol.

Here's the flow at a high level. When your client establishes a subscription, AppSync opens a WebSocket connection and initiates an MQTT handshake. The client becomes an MQTT subscriber to a topic that corresponds to your subscription. On the server side, when a mutation resolves successfully, AppSync publishes a message to that same MQTT topic. All subscribers listening on that topic receive the published message, which contains the subscription data.

This design has several elegant consequences. First, it naturally handles multiple subscribers—MQTT's pub-sub model means one mutation can instantly notify hundreds of listening clients without the server needing to track each connection individually. Second, it decouples the mutation resolver from subscription notification logic, keeping your code clean. Third, it enables sophisticated filtering at the transport layer rather than forcing all notifications through to clients who then discard irrelevant ones.

The WebSocket connection itself is ephemeral and can disconnect. AppSync handles reconnection logic automatically, though you should understand that a reconnection creates a new MQTT connection. This is important for designing resilient subscription logic in your client.

### Connecting the Mutation to the Subscription

The bridge between mutations and subscriptions requires explicit configuration in your AppSync schema and resolvers. When you define a subscription, you're essentially declaring: "I'm interested in updates of this type." When a mutation runs, you must tell AppSync which subscriptions to notify.

Let's look at a practical example. Suppose you have a chat application. Your schema might look like this:

```graphql
type Message {
  id: ID!
  content: String!
  authorId: ID!
  timestamp: AWSDateTime!
}

type Mutation {
  sendMessage(content: String!, authorId: ID!): Message
}

type Subscription {
  onMessageSent: Message
}
```

To make this work, you need to:

1. **Implement the mutation resolver** that writes the message to your data source (DynamoDB, RDS, etc.)
2. **Configure the subscription resolver** to publish the message to subscribers

In AppSync, you typically use AppSync's built-in `$util.subscriptions.publish()` utility in your mutation resolver. Here's a conceptual example using VTL (Velocity Template Language), which is still widely used:

```velocity
#set($payload = {
  "id": $util.autoId(),
  "content": $input.getArgument("content"),
  "authorId": $input.getArgument("authorId"),
  "timestamp": $util.time.nowISO8601()
})

$util.subscriptions.publish("onMessageSent", "onMessageSent", $payload)

#set($result = $context.result)
$payload
```

When this resolver executes, it publishes the `$payload` to the MQTT topic associated with the `onMessageSent` subscription. Any client subscribed to that topic receives the message immediately.

If you're using modern AppSync (with JavaScript or Python resolvers), the pattern is similar:

```javascript
export function request(ctx) {
  return {};
}

export function response(ctx) {
  const message = {
    id: ctx.request.id,
    content: ctx.args.content,
    authorId: ctx.args.authorId,
    timestamp: new Date().toISOString()
  };

  ctx.subscriptions.publish("onMessageSent", "onMessageSent", message);
  
  return message;
}
```

The first argument to `publish` is the subscription operation name, and the second is the subscription resolver field name. They often match, but they don't have to.

### Filtering Subscriptions with Arguments

One of AppSync's most powerful features is the ability to filter subscriptions using arguments. Without filtering, subscribing to `onMessageSent` would notify you of every message sent in your entire application. That's wasteful and wrong.

Subscription arguments let you narrow the scope. Consider a refined schema:

```graphql
type Subscription {
  onMessageSent(channelId: ID!): Message
  onUserTyping(channelId: ID!): TypingIndicator
}
```

Now a client can subscribe only to messages for a specific channel:

```graphql
subscription OnMessagesInGeneralChat {
  onMessageSent(channelId: "general-channel-123") {
    id
    content
    authorId
    timestamp
  }
}
```

Behind the scenes, AppSync constructs a unique MQTT topic for each combination of subscription and arguments. A subscription to `onMessageSent(channelId: "general")` publishes to a different topic than `onMessageSent(channelId: "random")`. This is both elegant and important—it means the filtering happens at the transport layer, not in your application logic.

To make filtering work, your mutation resolver must include the argument values when publishing:

```javascript
export function response(ctx) {
  const message = {
    id: ctx.request.id,
    content: ctx.args.content,
    authorId: ctx.args.authorId,
    channelId: ctx.args.channelId,
    timestamp: new Date().toISOString()
  };

  // Publish with the channelId argument so it reaches only
  // subscribers listening to that specific channel
  ctx.subscriptions.publish(
    "onMessageSent",
    "onMessageSent",
    message,
    { channelId: message.channelId }
  );
  
  return message;
}
```

Notice the fourth argument to `publish`: an object containing the subscription argument values. AppSync uses this to determine which MQTT topics to publish to. If a client subscribed with `channelId: "general"` and you publish with `channelId: "random"`, they won't receive the notification.

This filtering mechanism scales beautifully because the server doesn't maintain a list of subscribers. The pub-sub infrastructure handles routing automatically.

### Authorization and Security for Subscriptions

Real-time data is still sensitive data. AppSync allows you to attach authorization rules to subscriptions, ensuring that clients can only subscribe to data they're authorized to access.

You can specify authorization at the subscription level:

```graphql
type Query {
  getUser(id: ID!): User @aws_auth
}

type Subscription {
  onUserStatusChanged(userId: ID!): UserStatus
    @aws_auth
    @aws_iam
}
```

The `@aws_auth` directive requires the user to be authenticated with Cognito. The `@aws_iam` directive requires valid AWS IAM credentials. You can combine multiple authorization rules with OR logic—the user needs to satisfy at least one.

For more sophisticated scenarios, use the `@aws_lambda` authorization type to invoke a custom Lambda function that evaluates whether a user can subscribe:

```graphql
type Subscription {
  onUserStatusChanged(userId: ID!): UserStatus
    @aws_lambda(authorizerConfig: {
      identitySource: "Authorization"
    })
}
```

This Lambda receives the subscription request and can inspect the user's identity, the subscription arguments, and any other context to decide yes or no. It's powerful and flexible.

A critical point: authorization is checked at subscription time, not at notification time. When a client initiates a subscription, AppSync invokes your authorizer. If it returns deny, the subscription never starts. Once a subscription is active, AppSync assumes it remains authorized and delivers notifications without re-checking authorization for each message. This is by design—re-authorizing every notification would be expensive and slow. If you need to revoke a subscription, the client must disconnect and re-subscribe.

### Scaling Considerations and Limits

AppSync subscriptions scale well, but not infinitely. Understanding the limits helps you design architectures that work.

Each AppSync API can handle a concurrent subscription connection limit that depends on your configuration and AWS account. For most applications, the per-connection data throughput and the per-region limits are more relevant than raw connection count. AWS publishes these details in the AppSync documentation, but a reasonable rule of thumb is that you can comfortably support tens of thousands of concurrent subscriptions per API before hitting hard limits.

The real constraint is often the application's ability to publish notifications efficiently. If a single mutation triggers notifications to millions of subscribers, that's going to hurt. More practically, if you're designing a chat application where every message notifies all room subscribers, and a room has 100,000 people, you're likely to encounter performance issues.

To work around this, think about your subscription granularity. Instead of a single `onMessageSent` subscription, have clients subscribe to specific channels, rooms, or even individual notification queues. Filter at the subscription level so each client only receives what it needs.

Another consideration is connection stability. WebSocket connections can be unreliable, especially on mobile networks. AppSync handles this with automatic reconnection, but you should design your application to expect brief disconnections. When a client reconnects, it doesn't automatically receive messages it missed during the disconnection—subscriptions are not a queue. If you need guaranteed message delivery or message history, you'll need to combine subscriptions with a query that fetches recent data.

### Implementing Subscriptions in a React Client

Now let's see how this all looks from the client side. If you're using the AWS Amplify library with React, subscriptions become refreshingly simple.

First, define your GraphQL operations using the Amplify code generation tools. Your `graphql/subscriptions.ts` file might contain:

```javascript
import { gql } from '@aws-amplify/api-graphql';

export const onMessageSent = gql`
  subscription OnMessageSent($channelId: ID!) {
    onMessageSent(channelId: $channelId) {
      id
      content
      authorId
      timestamp
    }
  }
`;
```

In your React component, use the Amplify `useSubscription` hook or the lower-level `API.graphql()` method:

```javascript
import { API } from 'aws-amplify';
import { onMessageSent } from './graphql/subscriptions';
import { useEffect, useState } from 'react';

function ChatRoom({ channelId }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const subscription = API.graphql({
      query: onMessageSent,
      variables: { channelId }
    }).subscribe({
      next: (event) => {
        const newMessage = event.value.data.onMessageSent;
        setMessages(prev => [...prev, newMessage]);
      },
      error: (error) => console.error('Subscription error:', error),
      complete: () => console.log('Subscription completed')
    });

    return () => subscription.unsubscribe();
  }, [channelId]);

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.content}</div>
      ))}
    </div>
  );
}
```

The `subscribe()` method returns an RxJS subscription that you should unsubscribe from in your cleanup function. This prevents memory leaks and prevents duplicate subscriptions when your component re-renders.

If you're using the newer `useSubscription` hook from Amplify's React library, it's even cleaner:

```javascript
import { useSubscription } from 'aws-amplify/api-react';
import { onMessageSent } from './graphql/subscriptions';

function ChatRoom({ channelId }) {
  const { data, loading, error } = useSubscription(
    onMessageSent,
    { channelId }
  );

  if (loading) return <div>Connecting...</div>;
  if (error) return <div>Subscription failed: {error.message}</div>;

  const message = data?.onMessageSent;
  return message ? <div>{message.content}</div> : null;
}
```

This hook manages subscription lifecycle for you, including cleanup. However, be aware that it re-subscribes whenever the variables change, which is usually what you want.

For production applications, consider adding connection state handling. AppSync subscription connections can drop, and you'll want to show users visual feedback:

```javascript
function useSubscriptionWithStatus(query, variables) {
  const [status, setStatus] = useState('connecting');
  const { data, loading, error } = useSubscription(query, { variables });

  useEffect(() => {
    if (error) {
      setStatus('error');
    } else if (loading) {
      setStatus('connecting');
    } else {
      setStatus('connected');
    }
  }, [loading, error]);

  return { data, status };
}
```

### Common Patterns and Pitfalls

Several patterns have emerged from real-world AppSync subscription usage. Understanding them helps you avoid mistakes.

**Pattern: Presence and Typing Indicators.** For features like "user is typing," you don't need the subscription to persist in your database. Instead, use a mutation that publishes a temporary notification:

```graphql
type Mutation {
  startTyping(channelId: ID!, userId: ID!): TypingIndicator
}

type Subscription {
  onUserTyping(channelId: ID!): TypingIndicator
}

type TypingIndicator {
  userId: ID!
  channelId: ID!
  timestamp: AWSDateTime!
}
```

The `startTyping` mutation publishes to the `onUserTyping` subscription without necessarily storing anything. Clients re-publish every few seconds while the user is typing, and stop when they stop. This creates a self-cleaning system where stale typing indicators disappear naturally.

**Pitfall: Forgetting to Handle Reconnections.** When a WebSocket disconnects and reconnects, your client gets a new connection but doesn't receive missed messages. Always have a fallback query that fetches recent data. In a chat app, when you connect, subscribe to new messages, but also query the last 20 messages to catch anything you missed.

**Pitfall: Over-Publishing.** A mutation that publishes to ten different subscriptions is fine. A mutation that publishes to 10,000 subscriptions (because it matches 10,000 different subscription argument combinations) is not. Structure your subscriptions to match your access patterns, not the other way around.

**Pattern: Client-Side Filtering.** Sometimes you can't filter at the subscription level. For example, if you subscribe to all messages but only want to display those from users you follow, do that filtering in the client. The subscription delivers all messages, but your React component only renders a subset. This trades bandwidth for simplicity and is often the right call for smaller datasets.

**Pitfall: Subscription Arguments and Security.** Remember that subscription arguments are part of the GraphQL operation sent by the client. Don't rely on subscription arguments alone for authorization. Always validate in your authorizer that the user is actually allowed to see data for that argument value. A client can't forge its way into seeing data it shouldn't just by changing the argument.

### Monitoring and Debugging Subscriptions

AppSync provides CloudWatch metrics for subscriptions. You can monitor active subscription connections, subscription messages published, and subscription connection errors. Set up alarms for unusual patterns—a sudden spike in connection errors might indicate a client bug or network issue.

For debugging during development, enable AWS AppSync request/response logging. The logs show every subscription connect/disconnect event and the data published through subscriptions. Be cautious with logging in production, as subscriptions can be high-volume.

On the client side, log subscription lifecycle events:

```javascript
const subscription = API.graphql({
  query: onMessageSent,
  variables: { channelId }
}).subscribe({
  next: (event) => {
    console.log('Received:', event.value.data);
  },
  error: (error) => {
    console.error('Subscription error:', error);
  },
  complete: () => {
    console.log('Subscription complete');
  }
});
```

This helps you understand whether issues are on the server side (subscriptions not being published) or the client side (subscriptions not receiving published messages).

### Conclusion

AppSync subscriptions abstract away much of the complexity of building real-time features, but understanding what's happening underneath helps you use them effectively. The MQTT-over-WebSockets architecture provides elegant publish-subscribe semantics with built-in filtering and scaling. Subscriptions connect naturally to mutations through the `publish` utility, allowing you to notify clients instantly when data changes.

The key takeaways: subscriptions are persistent, authorization happens at subscription time, filtering happens at the transport layer through subscription arguments, and real-time doesn't mean you can ignore eventual consistency and connection failures. Combine subscriptions with queries to handle missed messages, structure your subscriptions around your actual data access patterns, and always validate authorization carefully.

With these patterns in mind, you're ready to build responsive, real-time features—whether it's collaborative editing, live dashboards, chat applications, or any other scenario where your users need to see data change as it happens. The infrastructure handles the hard part; you focus on the user experience.
