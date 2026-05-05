---
title: "Cognito User Pool Search Limiting and Performance at Scale"
---

## Cognito User Pool Search Limiting and Performance at Scale

When you're building an application that needs to search through thousands of users, AWS Cognito User Pools might seem like an obvious choice for identity management. And in many ways, it is—Cognito handles authentication, MFA, password policies, and user lifecycle management with minimal operational overhead. But the moment you need to build a searchable user directory or create a user management console with filtering capabilities, you'll quickly discover that Cognito User Pools have significant limitations. Understanding these constraints early and knowing how to architect around them is crucial for building performant applications at scale.

### The Limitations You'll Encounter

Cognito User Pools provides two primary APIs for listing and searching users: `ListUsers` and `AdminListUsersInGroup`. On the surface, they seem adequate. In practice, they'll become your first bottleneck when you need sophisticated search capabilities.

The most immediate limitation is the **100-result maximum per API call**. This means that if you have 10,000 users, you'll need to paginate through at least 100 separate API calls just to retrieve everyone. Each call takes time, consumes API quota, and introduces latency—especially problematic if you're trying to build a responsive user management console.

Beyond pagination, the **filtering capabilities are severely restricted**. With `ListUsers`, you can filter by a handful of specific attributes: `email`, `phone_number`, `name`, `given_name`, `family_name`, `preferred_username`, and user status attributes like `email_verified` and `phone_number_verified`. You can also filter by custom attributes you've defined in your user pool. But here's the catch: filters use simple substring matching for strings and exact matching for other types. You cannot construct complex queries like "find all users created between January 1st and March 1st" or "find all users in the Engineering department who haven't logged in for 90 days."

This limitation stems from Cognito's design philosophy. User Pools are optimized for authentication and basic user management, not for serving as a general-purpose user directory database. The service deliberately constrains search functionality to maintain performance and to encourage developers to use appropriate tools for different jobs.

### Understanding the ListUsers API

Let's examine `ListUsers` in practical terms. The API accepts several parameters: `UserPoolId`, `AttributesToGet`, `Limit`, `PaginationToken`, and `Filter`. The `Limit` parameter can be set to any value up to 60, but the maximum number of results returned in a single response is always 100.

Here's what a basic `ListUsers` call looks like using the AWS CLI:

```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_abcd1234 \
  --limit 10
```

This returns up to 10 users from your pool, along with a `PaginationToken` if more results exist. To retrieve the next batch, you pass that token back:

```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_abcd1234 \
  --limit 10 \
  --pagination-token <token-from-previous-response>
```

The `Filter` parameter accepts a simple filter expression. For example, to find users with a specific email domain:

```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_abcd1234 \
  --filter "email ^= \"company.com\""
```

The filter syntax supports a few operators: `=` (equals), `^=` (starts with), and `contains`. But you cannot combine multiple filters with AND or OR logic, and you cannot perform range queries or date-based filtering. This is where the architectural limitations become most apparent.

### The AdminListUsersInGroup Alternative

When you need to filter users by group membership, the `AdminListUsersInGroup` API becomes relevant. Cognito User Pools support a group-based authorization model, where users can belong to multiple groups. If you've already organized your users into groups (perhaps `engineers`, `managers`, `interns`), you can query all members of a specific group:

```bash
aws cognito-idp admin-list-users-in-group \
  --user-pool-id us-east-1_abcd1234 \
  --group-name engineers \
  --limit 10
```

This is more efficient than calling `ListUsers` with a filter if your primary search dimension is group membership. However, it has the same 100-result maximum and pagination requirement. Additionally, you're limited to filtering by group—you can't combine group membership with other attribute filters in a single call.

### Why Complex Queries Aren't Possible

You might wonder why Cognito doesn't simply allow you to query by creation date, last login time, or other useful attributes. The answer lies in how Cognito is architected internally. User Pools are not built on a relational database or a full-featured search engine. They're optimized for their primary use case: storing user credentials and profile data with fast authentication lookups. The underlying data structures and indexes aren't designed to support arbitrary range queries or complex WHERE clauses.

This is actually a feature, not a bug. By limiting search capabilities, AWS can offer Cognito at a predictable price point without the operational complexity of managing a general-purpose database. But it means developers need to implement their own search layer when sophisticated querying is required.

### Architectural Pattern: Syncing to DynamoDB

The most effective pattern for maintaining a searchable user directory is to keep your own read-optimized copy of user data in DynamoDB, synced automatically from Cognito using Lambda triggers. Here's how it works:

Every time a user is created, updated, or deleted in Cognito, you can trigger a Lambda function that synchronizes the relevant data to DynamoDB. Cognito fires pre- and post-authentication triggers, as well as post-confirmation, post-sign-up, custom message, and user migration triggers. The most relevant for maintaining a search index are the post-confirmation and post-user-migration triggers, which fire after a user is created or migrated into your pool.

Let's walk through a practical implementation. First, create a DynamoDB table to store your searchable user data:

```
Table Name: UserDirectory
Primary Key: userId (String)
Global Secondary Indexes:
  - emailIndex: email (String) as partition key
  - departmentIndex: department (String) as partition key, createdAt (Number) as sort key
  - lastLoginIndex: lastLoginAt (Number) as partition key, userId (String) as sort key
```

Next, set up a Lambda function that responds to Cognito post-confirmation triggers. Here's a Node.js example:

```javascript
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  const { userAttributes } = event.request;
  const userId = event.userName;
  
  const userRecord = {
    userId,
    email: userAttributes.email,
    name: userAttributes.name,
    department: userAttributes['custom:department'] || 'unassigned',
    createdAt: Math.floor(Date.now() / 1000),
    lastLoginAt: null,
    status: 'ACTIVE'
  };
  
  try {
    await dynamodb.put({
      TableName: 'UserDirectory',
      Item: userRecord
    }).promise();
    
    console.log(`Synced user ${userId} to DynamoDB`);
  } catch (error) {
    console.error(`Failed to sync user ${userId}:`, error);
    throw error;
  }
  
  return event;
};
```

For user updates, use a post-authentication trigger to track login activity:

```javascript
exports.handler = async (event) => {
  const userId = event.userName;
  
  try {
    await dynamodb.update({
      TableName: 'UserDirectory',
      Key: { userId },
      UpdateExpression: 'SET lastLoginAt = :now',
      ExpressionAttributeValues: {
        ':now': Math.floor(Date.now() / 1000)
      }
    }).promise();
    
    console.log(`Updated last login for user ${userId}`);
  } catch (error) {
    console.error(`Failed to update login time for ${userId}:`, error);
    throw error;
  }
  
  return event;
};
```

Now, with data in DynamoDB, you can perform sophisticated queries that Cognito doesn't support. Want to find all engineers who haven't logged in for 30 days? That's a single DynamoDB query:

```javascript
const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

const result = await dynamodb.query({
  TableName: 'UserDirectory',
  IndexName: 'departmentIndex',
  KeyConditionExpression: 'department = :dept AND createdAt > :thirtyDaysAgo',
  FilterExpression: 'lastLoginAt < :threshold OR lastLoginAt = :null',
  ExpressionAttributeValues: {
    ':dept': 'engineering',
    ':thirtyDaysAgo': thirtyDaysAgo,
    ':threshold': thirtyDaysAgo,
    ':null': null
  }
}).promise();
```

This pattern trades simplicity for capability. You're now maintaining two sources of truth—Cognito for authentication, DynamoDB for search—but you gain the ability to build powerful user management interfaces.

### Handling Deletions and Large-Scale Syncs

The DynamoDB sync pattern works well for incremental changes, but you need to handle two special cases: user deletions and initial bulk synchronization.

For deletions, Cognito provides a post-user-delete trigger (available through admin APIs). Your Lambda function should remove the corresponding record from DynamoDB:

```javascript
exports.handler = async (event) => {
  const userId = event.userName;
  
  try {
    await dynamodb.delete({
      TableName: 'UserDirectory',
      Key: { userId }
    }).promise();
    
    console.log(`Deleted user ${userId} from DynamoDB`);
  } catch (error) {
    console.error(`Failed to delete user ${userId}:`, error);
    // Note: Don't re-throw here—the user is already deleted from Cognito
  }
  
  return event;
};
```

For initial synchronization of existing users, you'll need a batch process. Use `ListUsers` with pagination to pull all users from Cognito, then write them to DynamoDB in batch operations:

```javascript
const getAllUsers = async (userPoolId) => {
  let allUsers = [];
  let paginationToken = null;
  
  do {
    const params = {
      UserPoolId: userPoolId,
      Limit: 60
    };
    
    if (paginationToken) {
      params.PaginationToken = paginationToken;
    }
    
    const response = await cognito.listUsers(params).promise();
    allUsers = allUsers.concat(response.Users);
    paginationToken = response.PaginationToken;
    
  } while (paginationToken);
  
  return allUsers;
};

const syncUsersToDatabase = async (users) => {
  for (let i = 0; i < users.length; i += 25) {
    const batch = users.slice(i, i + 25);
    const writeRequests = batch.map(user => ({
      PutRequest: {
        Item: transformCognitoUserToRecord(user)
      }
    }));
    
    await dynamodb.batchWrite({
      RequestItems: {
        UserDirectory: writeRequests
      }
    }).promise();
    
    // DynamoDB has rate limits; add backoff if needed
  }
};
```

This approach scales reasonably well for thousands or even tens of thousands of users. For larger populations, consider breaking the sync into smaller chunks and running it over several minutes rather than all at once.

### Deciding When to Use Each Approach

The DynamoDB sync pattern isn't always necessary. If your user search requirements are minimal—perhaps just looking up a user by email in a login form—Cognito's built-in search is sufficient and simpler to maintain. The added complexity of maintaining a second data store isn't justified if you only query users occasionally.

However, if you're building a user management console that needs to filter users by multiple attributes, generate reports about user engagement, or perform analytics on user behavior, the sync pattern becomes invaluable. The incremental cost of a Lambda invocation and a DynamoDB write on user events is negligible compared to the operational overhead of implementing search capabilities within Cognito's constraints.

Consider also the recency requirements of your search data. The DynamoDB approach gives you near-real-time search—as soon as a user is created or updated in Cognito, the change is reflected in your search index. If you can tolerate a small delay (minutes or hours), you could alternatively run periodic batch synchronization jobs, reducing the operational complexity further.

### Performance Considerations and Scaling

As your user base grows, pagination becomes a real performance issue. Imagine fetching 100,000 users for reporting purposes. At a maximum of 100 results per request, that's 1,000 API calls, which could take several minutes even with parallel requests. This is where having a local DynamoDB copy shines—you can run complex queries against millions of records without pagination headaches.

DynamoDB itself scales elastically, so you won't hit the same hard limits. However, you should still design your indexes thoughtfully. If you're frequently filtering by department and creation date, create a global secondary index with department as the partition key and createdAt as the sort key. If you need to find inactive users by last login time, create another index with lastLoginAt as the partition key.

One subtle point: DynamoDB charges for provisioned throughput or on-demand capacity, so the cost scales with your query volume. If you're running hundreds of queries per second against your user directory, you'll need to allocate sufficient capacity. In most cases, on-demand pricing is more predictable than provisioned capacity for variable workloads.

### Handling Data Consistency

There's a small window of time between when a user is modified in Cognito and when that change is reflected in your DynamoDB copy. During this window, your search results might be slightly stale. For most applications, this is acceptable—a user management console displaying data that's a few hundred milliseconds delayed is still responsive from a user perspective.

However, if you have stronger consistency requirements, you have a few options. You could make your Lambda function synchronously update DynamoDB before returning control to Cognito, but this adds latency to user operations. Alternatively, you could read-through your application logic: when a user modifies their own profile, update both Cognito and DynamoDB directly from your application, then use Lambda triggers only to catch administrative changes made through the Cognito console.

### Conclusion

Cognito User Pools are an excellent service for authentication and basic user management, but their search capabilities are intentionally constrained. The 100-result limit, the inability to perform complex queries, and the restriction to substring matching are byproducts of a design focused on performance and simplicity rather than general-purpose data retrieval.

When you need sophisticated search capabilities, the architectural pattern of maintaining a synced DynamoDB copy strikes a good balance between operational simplicity and functionality. Lambda triggers handle incremental synchronization automatically, and DynamoDB provides the flexibility to query users by any combination of attributes. This approach scales well from hundreds to millions of users and integrates cleanly with Cognito's existing workflows.

The key insight is to view these tools as complementary rather than competing. Cognito handles identity and authentication—what it does best. DynamoDB handles searchability and analytics—what it's designed for. By understanding the strengths and limitations of each, you can build user management systems that are both performant and maintainable.
