---
title: "Querying DynamoDB Efficiently: FilterExpression vs KeyConditionExpression"
---

## Querying DynamoDB Efficiently: FilterExpression vs KeyConditionExpression

If you've spent any time working with DynamoDB, you've probably encountered a moment where you filtered query results and wondered whether you were actually saving money or just fooling yourself. The distinction between `KeyConditionExpression` and `FilterExpression` is subtle but critical to understanding how DynamoDB charges for reads and how to design efficient queries. Getting this wrong can quietly inflate your RCU (read capacity unit) bills and create performance bottlenecks that are harder to spot than a failed query.

In this article, we'll untangle these two powerful query mechanisms, explore when each is appropriate, and learn practical strategies for designing your data model so filtering happens where it matters most: in the key condition that stops DynamoDB from reading unnecessary items in the first place.

### Understanding the DynamoDB Query Pipeline

Before diving into the specifics, it helps to picture how DynamoDB executes a query. When you issue a `Query` operation, DynamoDB follows a straightforward but important sequence:

First, it evaluates your `KeyConditionExpression` against the partition key and sort key to pinpoint the exact items (or range of items) you're interested in. This is where the magic of DynamoDB's indexing happens—the engine uses these keys to navigate directly to the relevant data without scanning the entire table. Second, it retrieves those items from disk and deserializes them. Third, if you've provided a `FilterExpression`, DynamoDB applies that filter to each retrieved item, removing those that don't match. Finally, it returns the results to your application.

The crucial detail here is the billing model. DynamoDB charges you for items *read* during steps one and two, not for items *returned* after filtering in step three. This is where many developers encounter an unwelcome surprise.

### KeyConditionExpression: The Gatekeeper

`KeyConditionExpression` is your primary tool for narrowing which items DynamoDB retrieves in the first place. It operates exclusively on the partition key and sort key—the two attributes that define how DynamoDB physically stores and retrieves your data.

For a partition key, you can only specify equality. If your partition key is `UserId`, you might query for `UserId = 12345`. DynamoDB can then jump directly to all items belonging to that user.

For a sort key, you have more flexibility. You can specify equality (`SortKey = 'Order#2024-01'`), comparison operations (`SortKey > 'Order#2024-01'`), `BETWEEN` conditions (`SortKey BETWEEN 'Order#2024-01' AND 'Order#2024-12'`), or prefix matching (`begins_with(SortKey, 'Order#2024')`). Each of these helps you narrow the result set at the physical storage level.

Here's a concrete example. Suppose you have a Users table with `UserId` as the partition key and `CreatedAt` as the sort key. To fetch all users created in January 2024, you'd write:

```
KeyConditionExpression: 'UserId = :uid AND CreatedAt BETWEEN :start AND :end'
ExpressionAttributeValues: {
  ':uid': 'user-789',
  ':start': '2024-01-01',
  ':end': '2024-01-31'
}
```

DynamoDB reads only the items that satisfy both conditions. If user 789 has 100 items in the table and only 8 were created in January, DynamoDB retrieves 8 items and charges you for 8 RCUs (assuming 4 KB items, though the exact calculation is slightly more nuanced). The key insight is that the sort key condition prevented DynamoDB from reading the other 92 items.

### FilterExpression: The Final Checkpoint

`FilterExpression` operates on any attribute—partition key, sort key, or any other attribute in your item. Conceptually, it's the last step in the query pipeline, applied *after* items have already been retrieved and read into memory.

The critical detail: those retrieved items still consume RCUs, even if the filter removes them from the result set.

Let's extend the previous example. Suppose each user item has a `Status` attribute (`active` or `inactive`). If you wanted to fetch only active users created in January 2024, a tempting but inefficient approach might look like this:

```
KeyConditionExpression: 'UserId = :uid AND CreatedAt BETWEEN :start AND :end'
FilterExpression: 'Status = :active'
ExpressionAttributeValues: {
  ':uid': 'user-789',
  ':start': '2024-01-01',
  ':end': '2024-01-31',
  ':active': 'active'
}
```

The `KeyConditionExpression` still retrieves 8 items. But what if only 3 of those 8 are active? The query returns 3 items to your application, but you've been charged for 8 reads. The filter removed 5 items *after* they'd already consumed capacity.

This is not inherently wrong—sometimes filtering is the right choice. But you need to understand the cost and make a deliberate decision rather than accidentally incurring extra charges.

### Why FilterExpression Exists (And When It's Appropriate)

You might wonder: if `FilterExpression` doesn't reduce capacity costs, why use it at all?

FilterExpression is essential when you need to filter on attributes that aren't keys. In the example above, if `Status` is not a key attribute, you have no choice but to use a filter. You cannot include it in your `KeyConditionExpression`.

There are also scenarios where filtering is the pragmatic choice even when it involves extra reads. Imagine querying a large result set where only a small percentage matches your criteria. If you run a query that retrieves 1,000 items and filters down to 10, you pay for 1,000 reads. That seems wasteful. But if the alternative is a more complex data model with additional indexes, the straightforward query-and-filter approach might be simpler to maintain and fast enough for your use case. Every situation is different.

The key is awareness. If you find yourself regularly filtering away large percentages of your query results, that's a signal to revisit your data model design.

### Designing Keys to Eliminate Filters

The best way to handle high-cardinality filtering is to design it into your keys from the start. This is where sort key design becomes an art form.

Consider an e-commerce application where you track orders. Your primary table might have `CustomerId` as the partition key. For the sort key, you could use `OrderId`, which uniquely identifies each order. But if you frequently need to fetch only orders with a certain status (`shipped`, `pending`, `cancelled`), a smarter sort key design might be `Status#OrderId`. This way, queries like "fetch all pending orders for customer X" become efficient:

```
KeyConditionExpression: 'CustomerId = :cid AND SortKey BEGINS_WITH :status'
ExpressionAttributeValues: {
  ':cid': 'customer-456',
  ':status': 'pending#'
}
```

Now the key condition itself narrows the result set to only pending orders, and no filter is needed. You pay for only the orders you actually retrieve.

This technique—embedding filtering criteria into the sort key—is powerful but requires foresight. The downside is that you can have only one sort key per table. If you need to filter by multiple different attributes, you might need additional Global Secondary Indexes (GSIs).

A GSI is a completely separate index on your table with its own partition key and sort key. If your main table partitions by `CustomerId` and sorts by `Status#OrderId`, but you also frequently query by `OrderStatus` to find all pending orders across all customers, you could create a GSI with `Status` as the partition key and `CreatedAt` as the sort key. That GSI would let you query efficiently without filtering:

```
KeyConditionExpression: 'Status = :status'
ExpressionAttributeValues: {
  ':status': 'pending'
}
```

GSIs consume their own provisioned capacity (or use on-demand billing), and they duplicate your data, so they come with their own costs. But if the query pattern is common enough, the investment pays for itself in reduced RCU consumption and faster queries on the main table.

### Pagination and Filters: The Surprising Behavior

There's a subtle but important interaction between filters and pagination that catches many developers off guard.

When you use `Limit` in a query, you're telling DynamoDB to stop retrieving items once it has read that many from the key condition—not once it has returned that many to the application. If you set `Limit: 10` and apply a `FilterExpression` that removes 50% of items, DynamoDB will read 10 items, filter them down to 5, and return 5 to you. The `LastEvaluatedKey` will point to the 10th item read, not the 5th item returned.

This means pagination with filters can feel unintuitive. If you're iterating through pages with a filter, your page sizes might not be uniform. One page might return 10 items, the next might return 3, depending on how many items the filter removes.

Here's a practical scenario to illustrate. Suppose you're paginating through orders, reading 10 at a time, but filtering for only `shipped` status. Your first query reads 10 items and returns 7 shipped orders. You fetch the next page starting from `LastEvaluatedKey`, read another 10 items, and this time the filter returns only 2 shipped orders. The inconsistency isn't a bug—it's the expected behavior when filtering reduces the visible results.

If uniform page sizes matter for your UI or application logic, you might need to handle this in your application layer by continuing to paginate until you've accumulated enough filtered results to meet your desired page size.

### Practical Decision-Making: Filters or Keys?

So how do you decide whether to handle a filtering requirement through key design or a `FilterExpression`?

Start by understanding your query patterns. If a particular filter is applied in less than 5% of your queries, using a `FilterExpression` is pragmatic. The extra complexity of designing a GSI or rearranging your sort key isn't justified. If the same filter is applied in 50% of your queries, it's worth reconsidering your data model.

Consider the selectivity of the filter. If a filter removes only 5% of items, you're wasting 95% of your capacity. If it removes 60%, the waste is more tolerable. But "more tolerable" is not the same as "efficient," so calculate whether key-based filtering would be worth the modeling effort.

Think about the size of your result sets. A query that retrieves 100 items and filters down to 50 is less concerning than one that retrieves 10,000 items and filters down to 500. The absolute number of wasted reads matters.

Finally, factor in operational complexity. A simpler data model with some filtering might be easier to understand and maintain than a complex model with multiple GSIs designed for every conceivable query pattern. There's no universal right answer, only tradeoffs to evaluate for your specific situation.

### Real-World Example: A Complete Query Workflow

Let's walk through a realistic example to tie everything together. Imagine you're building a SaaS platform where teams manage tasks. Your Task table has `TeamId` as the partition key and `TaskId` as the sort key. Each task has a `Status` attribute (`open`, `in-progress`, `completed`) and a `Priority` attribute (`low`, `medium`, `high`).

Your application needs to support several queries: fetch all tasks for a team, fetch all open tasks for a team, fetch all high-priority tasks across all teams, and fetch all open high-priority tasks for a team.

For the first query—all tasks for a team—your `KeyConditionExpression` is straightforward:

```
KeyConditionExpression: 'TeamId = :tid'
```

For the second query—all open tasks for a team—you could use a filter, but if this is a common query, a better approach is to redesign your sort key as `Status#TaskId`. Then:

```
KeyConditionExpression: 'TeamId = :tid AND SortKey BEGINS_WITH :open'
```

For the third query—all high-priority tasks across all teams—you need a GSI. Create one with `Priority` as the partition key and `CreatedAt` as the sort key:

```
KeyConditionExpression: 'Priority = :high'
```

For the fourth query—open high-priority tasks for a team—you have a choice. You could query the main table with `KeyConditionExpression: 'TeamId = :tid AND SortKey BEGINS_WITH :open'` and then filter by priority. Or you could query the priority GSI with `KeyConditionExpression: 'Priority = :high'` and filter by team. The choice depends on which condition is more selective. If teams are small and high-priority is rare, filtering by team on the priority GSI is better. If teams are large and high-priority is common, filtering by priority on the main table is better.

This example shows that data modeling isn't about finding a single perfect design—it's about making conscious tradeoffs based on your actual query patterns.

### Monitoring and Optimization

Once your queries are in production, monitoring becomes essential. CloudWatch metrics like `ConsumedReadCapacityUnits` and `ReturnedItemCount` are your friends. If you see a query returning 50 items but consuming 500 RCUs, something is very wrong—likely a filter removing 90% of reads.

Use CloudWatch Insights or application-level logging to track query patterns. If you notice a filter being applied in every query and consistently removing a significant percentage of results, that's a sign to revisit your data model.

Also consider the latency implications. Every additional RCU consumed increases query latency, especially during high contention. A more efficient query design can have both cost and performance benefits.

### Conclusion

The distinction between `KeyConditionExpression` and `FilterExpression` is fundamental to using DynamoDB efficiently. `KeyConditionExpression` operates on your partition and sort keys and determines which items DynamoDB retrieves—this is where the efficiency gains happen. `FilterExpression` operates after retrieval and doesn't reduce RCU consumption, though it's sometimes the pragmatic choice for filtering on non-key attributes.

The most efficient designs push as much filtering as possible into the key condition, either by designing your sort key thoughtfully or by creating GSIs for common query patterns. But this needs to be balanced against data modeling complexity. There's no single rule; instead, understand your query patterns, measure your actual costs, and make intentional tradeoffs.

As you design and optimize DynamoDB queries, keep this principle front and center: read fewer items in the first place, and you'll spend less on capacity while also serving queries faster. That's the power of well-designed keys.
