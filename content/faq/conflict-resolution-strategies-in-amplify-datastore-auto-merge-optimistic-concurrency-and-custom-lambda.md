---
title: "Conflict Resolution Strategies in Amplify DataStore: Auto Merge, Optimistic Concurrency, and Custom Lambda"
---

## Conflict Resolution Strategies in Amplify DataStore: Auto Merge, Optimistic Concurrency, and Custom Lambda

When you build modern applications with AWS Amplify DataStore, you're embracing a development model that works seamlessly offline and online. Users expect their data to synchronize instantly across devices and in the cloud without losing a beat. But what happens when two users edit the same record simultaneously, or a user makes changes offline that conflict with updates already in the backend? This is where conflict resolution becomes not just a technical nicety—it's essential to delivering a reliable user experience.

Amplify DataStore provides three distinct strategies for handling conflicts when syncing offline changes with your AppSync backend. Understanding when and how to use each one will help you build applications that handle real-world concurrency challenges with grace. In this article, we'll explore Auto Merge, Optimistic Concurrency, and Custom Lambda resolvers in depth, with practical examples that show you how to implement them and why they matter.

### Why Conflict Resolution Matters in Offline-First Architecture

Before diving into the strategies themselves, let's establish why this problem exists. Amplify DataStore is built for offline functionality. Your app caches data locally and syncs with the backend when connectivity returns. This is fantastic for user experience—taps are instant, no spinning wheels—but it introduces a challenge: what if two devices both offline make conflicting changes to the same record? Or what if the backend changed the data before the offline device's sync completes?

Without a conflict resolution strategy, you'd have to choose between losing one user's changes or forcing them into a manual merge flow. Neither option is acceptable for modern apps. Amplify's conflict resolution system handles this automatically, and you control the strategy based on your domain requirements.

The three strategies exist on a spectrum. Auto Merge is the most permissive and works best when fields rarely conflict. Optimistic Concurrency is stricter and works well when you want to detect any concurrent modifications. Custom Lambda is the most flexible—you define the business logic entirely. Let's explore each.

### Understanding Auto Merge: Field-Level Granularity

Auto Merge is the default conflict resolution strategy in Amplify DataStore, and it's more sophisticated than it first appears. Rather than treating an entire record as a unit, Auto Merge operates at the field level. This means two conflicting updates can actually both succeed if they touched different fields.

Here's a practical scenario: imagine a social media app where users can edit both their profile bio and their profile photo. User A is offline and updates their bio. Meanwhile, User B (via a different device or in a different part of the app) updates the same user's photo in the backend. When User A comes back online, Auto Merge recognizes that the bio and photo are separate fields. It applies both changes—the new bio from User A and the new photo from User B. Everyone's happy.

But Auto Merge has important nuances, especially when lists are involved.

#### How Auto Merge Handles Scalar Fields

For scalar fields (strings, numbers, booleans, and similar primitive types), Auto Merge uses a simple rule: if two updates touch different fields, both succeed. If two updates touch the *same* field, the last write wins. This is determined by timestamps on the conflicting versions.

Let's look at a schema example:

```graphql
type Post @model {
  id: ID!
  title: String!
  content: String!
  likes: Int!
  isPublished: Boolean!
}
```

Suppose the backend has a Post with title "My Day" and content "I did stuff". Device A goes offline and changes the title to "My Great Day". Meanwhile, in the backend (or on Device B), someone changes the content to "I did amazing stuff". When Device A syncs, Auto Merge sees:

- Device A changed: title
- Backend changed: content
- Result: Both changes apply. The Post now has title "My Great Day" and content "I did amazing stuff".

But if both devices had changed the title, only one would win—the one with the later timestamp. This is where the "last write wins" aspect comes in. It's straightforward and prevents infinite loops, but you lose the earlier change silently.

#### The List Field Surprise

Here's where Auto Merge behaves differently, and it's critical to understand. Consider a schema with a one-to-many relationship:

```graphql
type BlogPost @model {
  id: ID!
  title: String!
  comments: [Comment] @hasMany
}

type Comment @model {
  id: ID!
  content: String!
  blogPostId: ID!
}
```

When you have list fields (whether through `@hasMany`, arrays, or connection types), Auto Merge does *not* perform field-level merging on the list itself. Instead, it treats the entire record containing the list as a single unit for conflict purposes. If two devices modify the same parent record that has a list field, and one of those modifications involves the list, the last write wins for the entire record. This prevents complex list merging scenarios that could lead to unexpected behavior.

This behavior is a trade-off. It's predictable and safe, but it means conflicting changes to the same record—even if to different list fields—result in a last-write-wins resolution for the whole record.

#### When to Use Auto Merge

Auto Merge works best when you have a schema where:

- Most fields are independent and rarely updated concurrently
- List modifications are rare or your business logic tolerates last-write-wins for records containing lists
- Your application doesn't require strict concurrency detection
- You want minimal configuration and maximum simplicity

A real-world example might be a note-taking app where users rarely edit the same note simultaneously, or a product catalog where different teams update different product attributes (one team updates pricing, another updates descriptions). Auto Merge handles these scenarios elegantly without requiring extra configuration.

### Understanding Optimistic Concurrency: Version-Based Detection

Optimistic Concurrency takes a different approach. Instead of merging at the field level, it uses version numbers to detect conflicts. Here's how it works: each record gets a version number. When you update a record, you include the version number you expect. If the backend's version doesn't match, the write is rejected. This is also called "conditional writes" or "optimistic locking."

The strategy is called "optimistic" because you optimistically assume your write will succeed—you proceed without blocking—but the system will detect if your assumption was wrong. It's "concurrency" detection because it's designed to catch concurrent modifications.

#### How Versioning Works

When you configure Optimistic Concurrency in your DataStore, Amplify adds a hidden `_version` field to your model. You don't see it in the schema, but it's there:

```graphql
type Product @model {
  id: ID!
  name: String!
  price: Float!
}
```

Internally, Amplify tracks:

```graphql
type Product @model {
  id: ID!
  name: String!
  price: Float!
  _version: Int!
}
```

When your app fetches a Product, it receives the current version. When you update that Product offline, DataStore stores both the new data and the version number you had. When you sync online, the AppSync mutation includes a condition: `_version == 3` (or whatever the version was). If the backend's version has incremented—meaning someone else updated it—the condition fails, and the mutation is rejected.

#### Handling Conflict Response

When a conflict is detected in Optimistic Concurrency, the local change is *not* automatically applied. Instead, it's rejected, and your app receives a conflict notification. You must then decide what to do: fetch the latest version from the backend and retry, or discard your local change.

Here's a practical code example using Amplify's API:

```javascript
import { DataStore } from 'aws-amplify/datastore';
import { Product } from './models';

async function updateProduct(productId, newData) {
  try {
    const product = await DataStore.query(Product, productId);
    const updated = await DataStore.save(
      Product.copyOf(product, updated => {
        updated.name = newData.name;
        updated.price = newData.price;
      })
    );
    console.log('Update succeeded:', updated);
  } catch (error) {
    if (error.errorType === 'ConflictUnresolved') {
      console.log('Conflict detected. Backend version differs.');
      // Handle conflict: fetch latest, merge, or show user
      const latestProduct = await DataStore.query(Product, productId);
      console.log('Latest backend version:', latestProduct);
    }
  }
}
```

When a conflict occurs, you have choices. A typical flow might be:

1. Fetch the latest version from the backend
2. Present the conflict to the user with both versions
3. Let them choose which changes to keep
4. Retry the update with the resolved data

Alternatively, for some scenarios, you might simply discard the local change and fetch the latest. The point is: you have explicit control.

#### When to Use Optimistic Concurrency

Optimistic Concurrency is ideal when:

- Concurrent edits to the same record are possible and problematic
- You want to detect conflicts explicitly rather than silently resolve them
- Your domain requires strong consistency guarantees (financial transactions, inventory management)
- You can handle conflict notifications and resolution in your app logic
- You need to prevent last-write-wins scenarios for critical data

A real-world example is a collaborative spreadsheet where multiple users might edit the same cell. You want to detect and handle that explicitly, not silently overwrite one user's change with another's.

### Implementing Custom Lambda: Maximum Control

When neither Auto Merge nor Optimistic Concurrency fits your needs, Custom Lambda resolvers give you total control. You implement a Lambda function that receives the conflicting versions and returns the resolved version. You decide the logic entirely.

#### How Custom Lambda Conflict Resolution Works

When you configure a Custom Lambda resolver in your DataStore schema, Amplify calls that Lambda function whenever a conflict is detected during sync. The Lambda receives:

- The local (offline) version of the record
- The server version of the record
- Metadata about the conflict (timestamps, version numbers, etc.)

Your Lambda returns the resolved version, which then gets saved to the backend and synced locally.

#### Setting Up Custom Lambda Resolution

To use Custom Lambda, you configure it in your `amplify/backend/api/[apiname]/schema.graphql` using the `@model` directive's `conflict` parameter:

```graphql
type BlogPost @model(conflict: { handler: "customConflictResolver" }) {
  id: ID!
  title: String!
  content: String!
  authorId: ID!
}
```

Then, you create a Lambda function. AWS Amplify provides scaffolding for this, but here's what the function signature typically looks like:

```python
import json
import boto3

def handler(event, context):
    # event['args'] contains the local and server versions
    local = event['args']['local']
    server = event['args']['server']
    
    # Your custom logic here
    resolved = resolve_conflict(local, server)
    
    return {
        'statusCode': 200,
        'body': json.dumps(resolved)
    }

def resolve_conflict(local, server):
    # Example: take the longer content (collaborative scenario)
    if len(local.get('content', '')) > len(server.get('content', '')):
        return local
    return server
```

#### Real-World Custom Logic Example

Imagine you're building a collaborative document editor. Two users edit a document offline. User A adds three paragraphs. User B adds two paragraphs. When they sync, you don't want to pick one version over the other—you want to merge their contributions.

Your Lambda could implement this logic:

```python
def resolve_conflict(local, server):
    # Treat content as a list of paragraphs
    local_paragraphs = local.get('content', '').split('\n\n')
    server_paragraphs = server.get('content', '').split('\n\n')
    
    # Merge: combine both sets, removing exact duplicates
    merged_paragraphs = list(dict.fromkeys(
        local_paragraphs + server_paragraphs
    ))
    
    # Preserve timestamps and metadata from the newer write
    resolved = server.copy() if server.get('_lastUpdate', 0) > local.get('_lastUpdate', 0) else local.copy()
    resolved['content'] = '\n\n'.join(merged_paragraphs)
    
    return resolved
```

This logic combines both users' contributions rather than discarding one. It's domain-specific and wouldn't make sense for all apps, but for collaborative editing, it's powerful.

#### Another Example: Priority-Based Resolution

In an inventory management system, you might resolve conflicts based on business rules:

```python
def resolve_conflict(local, server):
    # For inventory, server always wins on quantity
    # but local changes to SKU or description are preserved if they're edits
    
    resolved = server.copy()
    
    # If local has a description that's longer/more detailed, use it
    if len(local.get('description', '')) > len(server.get('description', '')):
        resolved['description'] = local['description']
    
    # Never let local override quantity - server is source of truth
    resolved['quantity'] = server['quantity']
    
    return resolved
```

#### When to Use Custom Lambda

Custom Lambda is right when:

- Your conflict resolution logic is domain-specific and complex
- You need to merge data intelligently rather than pick a winner
- Your business rules require specific handling (e.g., certain fields are sources of truth, others can be merged)
- Auto Merge and Optimistic Concurrency don't capture your semantics
- You're okay with the operational overhead of maintaining a Lambda function

The tradeoff is complexity. Lambda functions add latency to the sync process, introduce another point of failure, and require careful testing. But when your business logic demands it, they're invaluable.

### Comparing the Three Strategies

Let's look at how each strategy handles the same scenario to clarify the differences.

Imagine a scheduling app where a resource (say, a conference room) has two attributes: `name` and `currentBookingId`. Device A offline changes the name from "Board Room A" to "Meeting Room A". Meanwhile, the backend updates `currentBookingId` from null to "booking123".

With **Auto Merge**: Both changes apply. The room is now "Meeting Room A" with currentBookingId "booking123". Conflict resolved, user doesn't know anything happened.

With **Optimistic Concurrency**: The local change is rejected because the record's version changed. Device A gets a conflict notification. The app might then fetch the latest version, show the user that the room's booking changed, and ask if they still want to rename it.

With **Custom Lambda**: Your Lambda sees both changes. It could decide: "Name changes and booking changes are independent—apply both" (like Auto Merge), or "If a room is booked, don't allow name changes" (business rule), or any other logic you implement.

### Configuring DataStore for Each Strategy

Configuration happens in your DataStore setup, typically in an Amplify initialization file.

For **Auto Merge** (default), no special configuration is needed:

```typescript
import { Amplify } from 'aws-amplify';
import config from './amplifyconfiguration.json';

Amplify.configure(config);
// Auto Merge is default
```

For **Optimistic Concurrency**, you configure it when setting up DataStore:

```typescript
import { DataStore } from 'aws-amplify/datastore';

const dataStoreConfig = {
  conflictHandler: async (error) => {
    // This fires when a conflict is detected
    console.log('Conflict detected:', error);
    // Your resolution logic
  }
};

// The conflict detection happens automatically
// You handle it in your app's error handling
```

For **Custom Lambda**, the configuration is in your schema and the Lambda itself. You deploy it through Amplify:

```bash
amplify add function
amplify push
```

Then reference it in your schema, and Amplify wires it up to AppSync.

### Practical Considerations and Performance

Each strategy has performance implications worth considering.

**Auto Merge** is the fastest. Conflicts are resolved entirely on the backend without additional compute. The sync process is quick, and the user sees their data updated almost immediately (assuming they're online).

**Optimistic Concurrency** adds a small latency cost because the backend must check version numbers, but it's still very fast. The real cost is operational: your app must handle conflict rejections and retries. If conflicts are rare (and they often are), this is a non-issue. If conflicts are common, you'll need good UX to handle rejection notifications.

**Custom Lambda** has the highest latency because AppSync invokes a Lambda function for each conflicted record. If you're syncing hundreds of conflicted records, this could add seconds to the sync process. However, this is rarely the case in practice. Most apps sync successfully without conflicts, and when conflicts do occur, they're typically a small fraction of total records. Still, it's something to monitor.

### Real-World Decision Framework

Here's how to choose in practice:

1. **Start with Auto Merge.** It's the default, it's simple, and it handles most scenarios well.

2. **Switch to Optimistic Concurrency if** you detect that Auto Merge silently resolves conflicts in ways your users dislike. This typically happens when multiple users frequently edit the same records, and you want explicit control.

3. **Move to Custom Lambda only if** Optimistic Concurrency proves cumbersome and you have well-defined business logic for resolution. This is usually a minority of apps.

In a social media app where users rarely have overlapping edits? Auto Merge is perfect. In a collaborative document editor where concurrent edits are expected? Optimistic Concurrency or Custom Lambda. In a specialized domain like inventory management with complex rules? Custom Lambda.

### Common Pitfalls and How to Avoid Them

**Pitfall 1: Underestimating Auto Merge's Behavior with Lists**

Many developers assume Auto Merge operates at the field level for all field types. It doesn't—lists are different. If you have a model with a list and you expect field-level merging, you'll be surprised. The fix: test your conflict scenarios manually, especially if your models include lists or relationships.

**Pitfall 2: Not Handling Optimistic Concurrency Rejections**

Optimistic Concurrency only works if your app handles rejection properly. If you ignore the error and silently discard the update, users lose their changes. Implement proper error handling with user notifications.

**Pitfall 3: Over-Engineering with Custom Lambda**

Custom Lambda is powerful but tempting to over-engineer. Every conflict resolution rule you add to your Lambda is logic you must test and maintain. Keep the logic simple and focused on genuine business needs.

**Pitfall 4: Testing Only Happy Path**

The most common issue is testing only scenarios where there are no conflicts. Intentionally create conflict scenarios in development—go offline, make changes on multiple devices, come back online—and verify the resolution works as expected.

### Monitoring and Debugging

AWS CloudWatch is your friend here. Enable logging in your AppSync API and watch for conflict events. Custom Lambda functions should log their reasoning:

```python
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    logger.info(f"Conflict detected: local={event['args']['local']}, server={event['args']['server']}")
    resolved = resolve_conflict(event['args']['local'], event['args']['server'])
    logger.info(f"Resolved to: {resolved}")
    return resolved
```

Review these logs to understand your conflict patterns. Are conflicts rare? Happening frequently on specific records? Clustering at certain times? These insights guide your strategy choice.

### Conclusion

Amplify DataStore's three conflict resolution strategies give you the flexibility to handle offline-first development with sophistication. Auto Merge's field-level approach suits most applications, providing transparent conflict handling without complexity. Optimistic Concurrency offers explicit conflict detection for scenarios where concurrent edits are problematic and need awareness. Custom Lambda provides the ultimate control when your domain requires custom business logic.

The key is understanding that there's no universal "best" choice—it depends on your application's semantics, your users' editing patterns, and how your business rules define a correct resolution. Start simple with Auto Merge, monitor your conflict patterns, and only add complexity when you have evidence it's needed. This pragmatic approach, combined with thorough testing of conflict scenarios, will help you build reliable applications that handle the complexities of offline-first architecture with grace.
