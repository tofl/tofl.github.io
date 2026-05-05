---
title: "AWS CLI Pagination Deep Dive: --page-size, --max-items, and NextToken"
---

## AWS CLI Pagination Deep Dive: --page-size, --max-items, and NextToken

When you're working with AWS from the command line, you'll eventually hit a moment where a single API call isn't enough. Maybe you're listing thousands of EC2 instances, scanning a massive DynamoDB table, or retrieving hundreds of CloudFormation stacks. The AWS CLI doesn't just dump all results at once—it uses pagination, a mechanism that breaks large result sets into manageable chunks. Understanding how pagination works isn't just a matter of convenience; it's essential for writing reliable automation scripts, avoiding timeouts, and efficiently querying AWS services at scale.

The challenge many developers face is that pagination involves several moving parts: the `--page-size` parameter controls how much data AWS sends back per request, `--max-items` controls how much data you actually display or process, and `NextToken` allows you to resume where you left off. These three concepts often get tangled together in developers' minds, leading to confusion about which parameter does what and when to use each one. In this article, we'll untangle that confusion and show you practical patterns for handling paginated responses correctly.

### Understanding the Pagination Landscape

Pagination in the AWS CLI operates on two distinct levels: the server side and the client side. This dual-layer approach is crucial to grasp because it determines how efficiently your scripts run and whether you're paying unnecessary API costs.

**Server-side pagination** refers to how AWS itself breaks up results. When you make an API call to, say, list EC2 instances, AWS doesn't return all instances in a single response—it returns a batch and provides a token (the `NextToken`) that lets you fetch the next batch. This is controlled by `--page-size`. The page size you specify tells AWS how many items to include in each response it sends back to you. A smaller page size means more API calls but fresher intermediate results; a larger page size means fewer API calls but potentially longer waits for each response.

**Client-side pagination**, on the other hand, is what the AWS CLI does with those server-side pages once it receives them. The `--max-items` parameter tells the CLI "I don't care how many pages exist on the server—just stop and show me results after you've collected this many items total." This is a client-side constraint applied after the CLI has already fetched data from AWS.

Think of it this way: imagine you're ordering items from a warehouse. The warehouse (AWS) can send you boxes (pages) of a certain size (`--page-size`). You, the customer (the CLI), can decide to stop your entire order after receiving a certain number of total items (`--max-items`). You might receive three full boxes and then decide you have enough, even if you could request more.

### The --page-size Parameter: Controlling AWS API Requests

The `--page-size` parameter directly influences how AWS breaks up your results on the server. Each service has a default page size—for example, EC2 DescribeInstances typically defaults to 5 items per page, while S3 ListObjects defaults to 1000 items per page. When you explicitly set `--page-size`, you override that default.

Here's a concrete example. Suppose you're listing all your EC2 instances:

```bash
aws ec2 describe-instances
```

By default, the CLI will make multiple API calls in the background, each fetching a default number of instances, and merge all results before displaying them. The process happens transparently, but it's happening.

Now, if you want to control that behavior explicitly, you can set a smaller page size:

```bash
aws ec2 describe-instances --page-size 2
```

With this command, each API call to AWS will fetch only 2 instances. If you have 100 instances, that means 50 API calls to AWS. This might sound wasteful, but there are legitimate reasons to do this. Small page sizes can be useful when you're dealing with network constraints, when you want to display progress in real time (showing results as they arrive rather than waiting for everything), or when you're concerned about memory usage on extremely large result sets.

Conversely, if you set a larger page size, you reduce the number of API calls:

```bash
aws ec2 describe-instances --page-size 100
```

Now each call fetches up to 100 instances, so 100 instances would require just 1 call. This is more efficient from a networking and latency perspective, but be aware that AWS has hard limits on page size that vary by service. Requesting a page size larger than the service allows will result in an error or the service silently using its maximum allowed size.

### The --max-items Parameter: Client-Side Result Limiting

Where `--page-size` controls how AWS structures the data it sends, `--max-items` controls how much of that data the CLI actually returns to you. This is purely a client-side operation.

Let's use a practical scenario. You have thousands of DynamoDB tables and you want to get a quick summary of the first 10:

```bash
aws dynamodb list-tables --max-items 10
```

With this command, the CLI will keep fetching pages from DynamoDB (using the default or specified `--page-size`) until it has accumulated 10 items, then it stops and displays those 10. Importantly, even though you only asked for 10 items, the CLI might have had to make multiple server-side calls if the page size was small. But you never see the intermediate pages—you only see the final 10 items.

The crucial difference from `--page-size` is that `--max-items` doesn't change how AWS behaves; it changes how the CLI behaves with AWS's responses. AWS still sends data in pages, but the CLI stops consuming those pages once it reaches your limit.

### NextToken and Resuming Iteration

When a result set is paginated, AWS provides a `NextToken` (sometimes called a `ContinuationToken` depending on the service) in each response. This token is an opaque string that encodes the position where AWS should resume returning results. It's the mechanism that allows pagination to work at all.

Consider listing a large S3 bucket with millions of objects:

```bash
aws s3api list-objects-v2 --bucket my-bucket --page-size 100
```

The CLI fetches the first 100 objects, but in the JSON response, there's a field called `NextContinuationToken`. If there are more results, this token will be present. The CLI automatically uses this token to fetch the next batch, and so on, until there's no token in the response (indicating you've reached the end).

When you use `--max-items`, the CLI includes a `NextToken` in its output, allowing you to manually resume from where you stopped:

```bash
aws s3api list-objects-v2 --bucket my-bucket --max-items 50
```

The output will show `NextToken` if there are more results. You can then run:

```bash
aws s3api list-objects-v2 --bucket my-bucket --starting-token <NextToken value> --max-items 50
```

The `--starting-token` parameter tells the CLI where to resume. This is particularly useful in interactive scenarios or when you're processing results in stages.

### Practical Patterns for Consuming All Pages

Now let's move into real-world scripting scenarios where you need to process all results across multiple pages programmatically.

#### Pattern 1: Simple Loop with Automatic Pagination

For many use cases, you can simply trust the AWS CLI to handle pagination for you. When you don't specify `--max-items`, the CLI fetches all pages automatically:

```bash
aws ec2 describe-instances --region us-east-1 | jq '.Reservations[].Instances[] | .InstanceId'
```

This command will fetch all EC2 instances across all pages and extract their IDs. The CLI handles all the pagination logic internally. This is the simplest approach and works well for moderate-sized result sets.

#### Pattern 2: Controlled Pagination with Bash and jq

For larger datasets or when you need more control, you can manually iterate through pages using `--starting-token` and check for the presence of `NextToken` in the response:

```bash
#!/bin/bash

bucket_name="my-bucket"
next_token=""

while true; do
  if [ -z "$next_token" ]; then
    response=$(aws s3api list-objects-v2 \
      --bucket "$bucket_name" \
      --page-size 100 \
      --output json)
  else
    response=$(aws s3api list-objects-v2 \
      --bucket "$bucket_name" \
      --page-size 100 \
      --continuation-token "$next_token" \
      --output json)
  fi

  # Process the current page
  echo "$response" | jq -r '.Contents[]? | .Key' | while read key; do
    echo "Processing: $key"
    # Do something with each key
  done

  # Check if there are more pages
  next_token=$(echo "$response" | jq -r '.NextContinuationToken // empty')
  
  if [ -z "$next_token" ]; then
    break
  fi
done
```

This pattern explicitly checks for `NextToken` (or `NextContinuationToken` in S3's case) and continues fetching pages until none remain. Notice that we're using `--page-size 100` to fetch 100 items per API call, which is a reasonable balance between efficiency and payload size. The script processes each page as it arrives, making it memory-efficient even for massive result sets.

#### Pattern 3: Combining --page-size and --max-items for Efficiency

In some scenarios, you want to process results in stages. For example, you might want to fetch results in chunks of 500 items at a time for batch processing, but you know there could be millions of results. You can combine `--page-size` and `--max-items`:

```bash
#!/bin/bash

table_name="my-dynamodb-table"
next_token=""
batch_size=500

while true; do
  if [ -z "$next_token" ]; then
    response=$(aws dynamodb scan \
      --table-name "$table_name" \
      --page-size 50 \
      --max-items "$batch_size" \
      --output json)
  else
    response=$(aws dynamodb scan \
      --table-name "$table_name" \
      --page-size 50 \
      --max-items "$batch_size" \
      --starting-token "$next_token" \
      --output json)
  fi

  # Process this batch of 500 items
  echo "$response" | jq -r '.Items[] | .id.S' | while read id; do
    echo "Processing item: $id"
    # Perform operations on this batch
  done

  # Get the token for the next batch
  next_token=$(echo "$response" | jq -r '.NextToken // empty')
  
  if [ -z "$next_token" ]; then
    break
  fi
done
```

This approach uses `--page-size 50` to fetch small pages (50 items per API call) but `--max-items 500` to accumulate 500 items before processing a batch. This provides a good balance: you're not overwhelming AWS with tiny API calls, but you're also not trying to hold a million items in memory at once.

### Understanding Service-Specific Pagination

It's important to recognize that different AWS services handle pagination differently, though the underlying concepts remain consistent.

For DynamoDB operations like `scan` and `query`, the `NextToken` field indicates whether there are more results. With DynamoDB specifically, you're limited by consumed read capacity, not just item count. A large page size might consume a lot of your read capacity in a single request, so if you're on a restricted budget, smaller page sizes can help you throttle your consumption.

S3 uses `ContinuationToken` and `NextContinuationToken` instead of just `NextToken`. When listing bucket contents, you use the `--continuation-token` parameter to resume, not `--starting-token`.

CloudFormation's `list-stacks` uses `NextToken`, while RDS's `describe-db-instances` also uses `NextToken`. The pattern is consistent, but always check the service documentation to be sure of the exact token field names.

EC2 is somewhat unusual in that some operations like `describe-instances` automatically paginate in the background without exposing tokens in the standard output unless you're looking for them explicitly. However, understanding that pagination is happening helps you reason about potential timeouts or slow queries on large fleets.

### Common Pitfalls and How to Avoid Them

One of the most frequent mistakes developers make is misunderstanding what `--max-items` does. Many assume it's equivalent to `--page-size`, thinking it controls how much the server sends per request. In reality, `--max-items` is a purely client-side limit. If you set `--max-items 10` on a large query, the CLI might still make multiple API calls to AWS to accumulate those 10 items, depending on what `--page-size` is set to.

Another pitfall is forgetting to handle the `NextToken` in automated scripts. If you write a script that processes results but doesn't check for and handle the `NextToken`, you'll only process the first page. Your script might work fine during development with a small result set (where everything fits in one page), but fail spectacularly in production with larger datasets.

Timeouts represent another major issue. Some AWS API calls, particularly large scans on DynamoDB or complex queries on RDS, can be slow if they involve scanning huge amounts of data. Setting an appropriate `--page-size` can help mitigate this. A very small page size means more round trips to AWS, which increases latency. A very large page size means each request takes longer to complete, potentially timing out. Finding the sweet spot (often somewhere between 50 and 500, depending on item size and network conditions) is key.

Related to timeouts is the risk of requesting data you don't actually need. If you only need the first 10 items, always use `--max-items 10` to tell the CLI to stop after fetching those. Without it, the CLI will fetch every single page from AWS, consuming time and potentially API quota.

It's also easy to confuse parameters across services. RDS uses different pagination keywords than S3, and Athena uses yet another set. Writing scripts that work across multiple AWS services requires paying attention to service-specific documentation.

### Combining Pagination with Filtering and Transformation

In practice, pagination is rarely used in isolation. You often combine it with other CLI features like `--filters` and `jq` transformations to process and refine results.

Here's a realistic example: you want to find all stopped EC2 instances across all pages and get just their instance IDs:

```bash
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=stopped" \
  --page-size 50 \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text
```

This command applies a filter on the AWS side (so AWS only returns stopped instances), uses a reasonable page size to balance efficiency, and uses the `--query` parameter to extract only the instance ID field. The CLI automatically handles pagination in the background.

If you need more complex transformations, jq becomes your friend:

```bash
aws dynamodb scan \
  --table-name users \
  --page-size 100 \
  --output json | \
  jq '.Items[] | select(.age.N | tonumber > 30) | {id: .id.S, name: .name.S, age: .age.N}'
```

This scans the DynamoDB table with a reasonable page size, then uses jq to filter for users over 30 and extract only specific fields. The CLI's automatic pagination ensures you process all items, not just the first page.

### Performance Tuning Through Pagination Parameters

When you're working with large-scale operations, pagination parameters become a performance tuning lever.

If your scripts are timing out, consider whether you're requesting unnecessarily large page sizes. A page size of 1000 items might sound efficient, but if each item is large, that could result in multi-megabyte responses and slow processing. Dropping to a page size of 100 or 200 can sometimes speed things up by reducing payload size, even though you make more API calls.

Conversely, if you're concerned about API call limits, increasing the page size reduces the number of calls. Some AWS services have rate limits on API calls (not item counts), so fetching 1000 items in one call is better than fetching 100 items in ten calls.

The `--max-items` parameter is useful when you're testing or debugging. Set it to a small number like 10 or 20 during development to get quick feedback. Then remove it or increase it in production.

### Conclusion

Pagination in the AWS CLI is one of those features that seems simple on the surface but reveals surprising depth once you start automating at scale. The key takeaway is that `--page-size` and `--max-items` operate at different layers: `--page-size` controls server-side pagination (how AWS chunks results), while `--max-items` controls client-side limiting (how many total items the CLI returns to you). Understanding this distinction transforms how you write efficient, reliable AWS automation scripts.

In practical terms, start by letting the CLI handle pagination automatically for moderate result sets. As your operations grow or your automation becomes more sophisticated, manually manage pagination using `--starting-token` to resume iteration and check for the presence of `NextToken` to detect when you've reached the end. Pay attention to service-specific token naming conventions, and always test your pagination logic with larger-than-expected result sets before deploying to production.

The time invested in mastering pagination is well spent—it's the difference between scripts that fail silently in production and scripts that reliably process hundreds of thousands of AWS resources, efficiently and correctly.
