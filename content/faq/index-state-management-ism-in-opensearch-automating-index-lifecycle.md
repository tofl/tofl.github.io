---
title: "Index State Management (ISM) in OpenSearch: Automating Index Lifecycle"
---

## Index State Management (ISM) in OpenSearch: Automating Index Lifecycle

Managing the lifecycle of search indexes manually is like babysitting—it requires constant attention and grows tiresome fast. As data volumes grow, you're faced with a familiar problem: indexes accumulate, storage costs balloon, and performance degrades. This is where Index State Management (ISM) in OpenSearch becomes invaluable. ISM is a plugin that automates the operational lifecycle of your indexes, letting you define policies that transition indexes through different states based on criteria like age, size, or document count. Instead of writing cron jobs or maintaining manual procedures, you describe your desired state once, and ISM handles the rest.

In this article, we'll explore how ISM works, how to write effective policies, and how to apply them across your infrastructure for cost-effective, scalable index management.

### Understanding Index Lifecycle Management and Why It Matters

Before diving into ISM specifics, let's establish why index lifecycle management matters in the first place. Consider a typical logging or analytics workload. Every day, your application generates gigabytes of new log data. Without a strategy, indexes grow indefinitely—old data sits alongside current data, consuming memory, disk space, and cluster resources. Query performance suffers because the cluster must sift through irrelevant historical data.

The natural solution is a tiered approach. Hot data—recent logs or metrics that are queried frequently—should live on fast, expensive hardware. Warm data—perhaps logs from last week—can move to slower, cheaper storage. Cold data—logs from months ago—might be deleted entirely or archived. ISM automates these transitions, eliminating manual interventions and reducing operational overhead.

ISM is particularly valuable for time-series workloads. If you're running log analytics, metrics collection, or security monitoring on OpenSearch, ISM can cut storage costs by 40–70% simply by enforcing sensible retention and tiering policies. It also improves cluster health by preventing unbounded index growth.

### How ISM Policies Work: States, Transitions, and Actions

An ISM policy is a JSON document that describes how an index should behave throughout its life. The core building blocks are states, transitions, and actions.

**States** represent conditions or phases of an index's lifecycle. A typical policy might have states like `hot`, `warm`, `cold`, and `delete`. When an index enters a state, ISM executes the actions associated with that state. The `hot` state might apply aggressive refresh settings for fast ingestion. The `warm` state might reduce the refresh interval and enable compression. The `delete` state removes the index entirely.

**Transitions** define the conditions under which an index moves from one state to another. Transitions are condition-based: "If the index is older than 7 days, transition to warm." "If the index reaches 50 GB, transition to rollover." Conditions can be based on index age, size, or document count. Transitions also support a `transition_seq` field that allows you to sequence transitions, ensuring they happen in order.

**Actions** are operations that ISM performs when an index is in a particular state. These include setting index settings (like the refresh interval), applying index templates, performing rollover operations, and even deleting indexes. Actions execute once when the index enters the state, unless you configure them to repeat.

Let's look at a concrete example. Here's a simple but realistic ISM policy:

```json
{
  "policy": "time-series-lifecycle",
  "description": "Manages log indexes: hot for 1 day, warm for 7 days, delete after 30 days",
  "default_state": "hot",
  "states": [
    {
      "name": "hot",
      "actions": [
        {
          "retry": {
            "count": 3,
            "backoff": "exponential",
            "delay": "1m"
          },
          "rollover": {
            "min_size": "50gb",
            "min_index_age": "1d"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "warm",
          "conditions": {
            "min_index_age": "1d"
          }
        }
      ]
    },
    {
      "name": "warm",
      "actions": [
        {
          "retry": {
            "count": 3,
            "backoff": "exponential",
            "delay": "1m"
          },
          "set_index_policy": {
            "policy_id": "warm-policy"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "cold",
          "conditions": {
            "min_index_age": "7d"
          }
        }
      ]
    },
    {
      "name": "cold",
      "actions": [
        {
          "retry": {
            "count": 3,
            "backoff": "exponential",
            "delay": "1m"
          },
          "set_read_only": {}
        }
      ],
      "transitions": [
        {
          "state_name": "delete",
          "conditions": {
            "min_index_age": "30d"
          }
        }
      ]
    },
    {
      "name": "delete",
      "actions": [
        {
          "retry": {
            "count": 3,
            "backoff": "exponential",
            "delay": "1m"
          },
          "delete": {}
        }
      ]
    }
  ]
}
```

This policy defines a four-state lifecycle. An index enters the `hot` state where it accepts writes and performs rollover once it reaches either 50 GB or 1 day old, whichever comes first. After 1 day, it transitions to `warm`, where we might adjust settings for less frequent queries. After 7 days, it moves to `cold` and becomes read-only. Finally, after 30 days, it's deleted automatically.

Notice the `retry` configuration. ISM includes built-in retry logic with exponential backoff. If an action fails—perhaps due to temporary cluster unavailability—ISM retries automatically rather than leaving the index in a stuck state.

### Key ISM Actions Explained

ISM supports several action types, each serving a specific operational purpose:

The **rollover** action is among the most valuable. Instead of managing index size manually, rollover automatically creates a new index when the current one meets size or age thresholds. This is crucial for time-series data. Rather than accumulating logs in a single `logs-2024-01-15` index until it becomes unwieldy, rollover creates `logs-2024-01-15-000001`, then `logs-2024-01-15-000002` as each fills up. This keeps individual indexes manageable and queryable.

The **set_index_policy** action allows you to modify index settings—for example, reducing the refresh interval from 1 second to 30 seconds for warm indexes, which significantly improves write performance. This is where you implement the hot/warm/cold tiering strategy.

The **delete** action, as you'd expect, removes the index entirely. Combined with a time-based condition, this is how you enforce retention policies without manual intervention.

The **set_read_only** action prevents writes to an index while allowing reads. This is useful for cold data—you want to preserve it for compliance or occasional querying, but you don't want accidental writes.

The **allocate** action (available in Amazon OpenSearch) moves data to different node types or availability zones. This is particularly powerful when combined with OpenSearch's UltraWarm feature, which stores index data in Amazon S3. You might use `allocate` to move warm data to UltraWarm nodes, drastically reducing costs.

### ISM vs. Elasticsearch's Index Lifecycle Management

If you've worked with Elasticsearch, you've likely encountered ILM (Index Lifecycle Management). ISM is OpenSearch's evolution of that concept, with meaningful improvements.

Both systems manage index lifecycle through policy definitions, but they differ in implementation details. ILM uses a managed index API and a `.ilm-history` index for tracking state changes. ISM is more transparent—it stores policy state directly in index metadata, making it easier to inspect via standard OpenSearch APIs.

ISM policies are more explicit about state transitions. In ILM, you define "phases" with timing rules. ISM separates concerns more cleanly: states represent operational conditions, actions are what you do in those states, and transitions are the rules that move between states. This separation makes complex policies easier to reason about.

Another advantage: ISM supports multiple transitions from a single state with different conditions. You might transition to "rollover" state if size is exceeded, or to "warm" state if age threshold is met—both from the `hot` state. ILM's phase-based model is less flexible in this regard.

Additionally, ISM allows you to specify `min_number_of_replicas` and `priority` in allocation actions, giving you finer control over shard distribution and resource allocation.

### Writing Practical ISM Policies: Common Patterns

Let's explore a few patterns that solve real problems:

**Pattern 1: Rollover-Based Hot/Warm with Size Threshold**

This pattern is ideal for high-volume ingestion where you want to manage both size and age:

```json
{
  "policy": "logs-lifecycle",
  "default_state": "hot",
  "states": [
    {
      "name": "hot",
      "actions": [
        {
          "rollover": {
            "min_size": "50gb",
            "min_index_age": "1d"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "warm",
          "conditions": {
            "min_index_age": "3d"
          }
        }
      ]
    },
    {
      "name": "warm",
      "actions": [
        {
          "set_index_policy": {
            "number_of_replicas": 1,
            "index.refresh_interval": "60s"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "delete",
          "conditions": {
            "min_index_age": "30d"
          }
        }
      ]
    },
    {
      "name": "delete",
      "actions": [
        {
          "delete": {}
        }
      ]
    }
  ]
}
```

This pattern creates a new index once the current one hits 50 GB or reaches 1 day old. The rolled-over index stays in `hot` until it's 3 days old, then transitions to `warm` where we reduce replicas and increase refresh intervals. After 30 days total, it's deleted.

**Pattern 2: UltraWarm Tiering (Amazon OpenSearch)**

If you're using Amazon OpenSearch with UltraWarm enabled, you can transition warm data to S3-backed storage for massive cost savings:

```json
{
  "policy": "s3-tiered-logs",
  "default_state": "hot",
  "states": [
    {
      "name": "hot",
      "actions": [
        {
          "rollover": {
            "min_size": "50gb"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "warm",
          "conditions": {
            "min_index_age": "2d"
          }
        }
      ]
    },
    {
      "name": "warm",
      "actions": [
        {
          "allocate": {
            "node_tag": "warm"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "ultrawarm",
          "conditions": {
            "min_index_age": "7d"
          }
        }
      ]
    },
    {
      "name": "ultrawarm",
      "actions": [
        {
          "allocate": {
            "node_tag": "ultrawarm"
          }
        }
      ],
      "transitions": [
        {
          "state_name": "delete",
          "conditions": {
            "min_index_age": "90d"
          }
        }
      ]
    },
    {
      "name": "delete",
      "actions": [
        {
          "delete": {}
        }
      ]
    }
  ]
}
```

UltraWarm nodes store index data in S3 while maintaining searchability. This pattern moves data to UltraWarm after 7 days, keeping 30 days of warm data on regular nodes and 60 days of ultrawarm data in S3. You achieve 70-80% cost reduction while maintaining compliance and auditability windows.

**Pattern 3: Document Count-Based Rotation**

For certain workloads, document count matters more than size. Here's a pattern for that:

```json
{
  "policy": "event-stream-lifecycle",
  "default_state": "hot",
  "states": [
    {
      "name": "hot",
      "actions": [
        {
          "rollover": {
            "min_doc_count": 10000000
          }
        }
      ],
      "transitions": [
        {
          "state_name": "delete",
          "conditions": {
            "min_index_age": "7d"
          }
        }
      ]
    },
    {
      "name": "delete",
      "actions": [
        {
          "delete": {}
        }
      ]
    }
  ]
}
```

This creates a new index once the current one reaches 10 million documents. It's simpler than the tiered approach and works well when you want minimal overhead and short retention.

### Applying ISM Policies to Index Templates

Writing a policy is only half the battle. You need to apply it to indexes automatically as they're created. This is where index templates come in.

You can create an ISM policy separately, then reference it in an index template. When new indexes matching that template are created, they automatically get the policy attached. Here's how:

First, create and store the ISM policy:

```bash
curl -X PUT "localhost:9200/_plugins/_ism/policies/logs-lifecycle" \
  -H 'Content-Type: application/json' \
  -d @policy.json
```

Then, create an index template that references the policy:

```json
{
  "index_patterns": ["logs-*"],
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "plugins.index_state_management.rollover_alias": "logs"
  },
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "message": { "type": "text" }
    }
  }
}
```

And register this template with ISM attachment:

```bash
curl -X PUT "localhost:9200/_index_template/logs-template" \
  -H 'Content-Type: application/json' \
  -d '{
    "index_patterns": ["logs-*"],
    "template": {
      "settings": {
        "number_of_shards": 3,
        "number_of_replicas": 1,
        "plugins.index_state_management.rollover_alias": "logs"
      },
      "mappings": {
        "properties": {
          "timestamp": { "type": "date" },
          "message": { "type": "text" }
        }
      }
    }
  }'
```

Finally, apply the policy to the template using the ISM API:

```bash
curl -X POST "localhost:9200/_plugins/_ism/add_policy" \
  -H 'Content-Type: application/json' \
  -d '{
    "policy_id": "logs-lifecycle",
    "indices": ["logs-*"],
    "notify": true
  }'
```

With this setup, every new index matching the `logs-*` pattern automatically gets the `logs-lifecycle` policy attached. ISM runs periodically (every 5 minutes by default) and evaluates whether indexes should transition to a new state. There's no manual work—policies apply consistently across your entire infrastructure.

### Monitoring ISM Policy Execution

ISM stores metadata about policy execution in each index. You can inspect the current state and see when the last transition occurred:

```bash
curl -X GET "localhost:9200/.opendistro-ism-config/_doc/logs-2024-01-15/_doc"
```

This returns metadata like the current state, the timestamp of the last policy execution, and details about any failed actions. ISM also emits events to a `.opendistro-ism-history-*` index that you can query and monitor.

To check the overall health of ISM policies, query the ISM stats API:

```bash
curl -X GET "localhost:9200/_plugins/_ism/stats"
```

This gives you aggregate data: how many indexes are managed by ISM, how many state transitions succeeded, how many failed, and the last execution time. Monitoring this helps catch policy issues early. If you see rising failure counts, it might indicate a misconfigured action or cluster resource constraints.

You can also set up monitoring and alerting using OpenSearch's built-in Alerting plugin to notify you if a policy execution fails repeatedly. This ensures you're aware of any operational issues without constant manual checking.

### Best Practices for ISM Policy Design

As you implement ISM at scale, a few principles emerge:

**Keep policies simple.** Avoid creating overly complex state machines with a dozen states. Most workloads benefit from 3-5 states: hot, warm, cold, and delete. Complexity makes policies harder to debug when things go wrong.

**Use meaningful state names.** Instead of `state1`, `state2`, use names that reflect the index's operational characteristics and expected query patterns. This makes policies self-documenting.

**Test policies in non-production first.** Create a test index matching your template and manually trigger policy evaluation to ensure transitions happen as expected. ISM is automatic once deployed, so you want confidence before applying to production.

**Set appropriate retry logic.** Most actions should have retry configurations with exponential backoff. This handles transient failures gracefully without operator intervention. Three retries with a 1-minute initial delay and exponential backoff is a reasonable starting point.

**Monitor failed transitions.** Even with retries, actions can fail. Common causes include insufficient disk space, misconfigured shard allocation tags, or permissions issues. Inspect the ISM history index regularly, especially after deploying new policies.

**Size rollover thresholds appropriately.** A 50 GB threshold is typical for many workloads, but audit your actual index sizes. If your queries are consistently slow, you might benefit from smaller indexes and more frequent rollover. If you're creating dozens of small indexes daily, increase the threshold.

**Separate policies for different workloads.** Don't try to force a single policy onto both application logs and metrics. Application logs might need 30-day retention and warm/hot tiers. Metrics might need only 7 days and can skip warm. Create separate policies for different data types.

**Document your policies.** ISM policies are code—treat them that way. Include version control, document why you chose specific thresholds, and maintain a change log. This helps when troubleshooting issues or onboarding new team members.

### Cost Optimization with ISM

The primary value of ISM is cost optimization. By automating tiered storage and retention, you avoid paying for storage and cluster resources that don't justify their cost.

Consider a concrete example. Suppose you ingest 100 GB of logs daily. Without ISM, you'd need to store 30 days of data (3 TB) on hot nodes capable of fast queries. At $0.50 per GB per month on hot storage, that's $1,500/month. With ISM tiering, you might store 3 days (300 GB) hot, 7 days (700 GB) warm at half the cost per GB ($0.25/GB = $175/month), and the remaining 20 days in UltraWarm at $0.023/GB = $23/month. Total: approximately $200/month, plus storage. You've reduced operational costs by 85% while maintaining compliance and searchability.

For organizations with very long retention requirements—audit logs, security data, compliance records—UltraWarm tiering with ISM is transformational. You can afford to keep years of data searchable without the operational burden of managing it manually.

### Common Pitfalls and Troubleshooting

Even with best practices, issues arise. Here are a few common scenarios and their solutions:

**Rollover not triggering:** Check that the rollover alias is correctly configured. The alias must exist and be associated with the current write index. If the alias is misconfigured, rollover can't create the new index.

**Indexes stuck in a state:** This usually happens when an action fails and all retries exhaust. Check the ISM history index for error details. Common causes are misconfigured shard allocation tags (if your cluster doesn't have warm nodes but the policy tries to allocate to them) or insufficient permissions for the plugin. Verify your cluster configuration and plugin permissions.

**Transitions not happening on schedule:** ISM runs every 5 minutes. If a transition should happen but doesn't, wait a few minutes and check the ISM stats. If it's still not transitioning, verify the condition is actually met. `min_index_age` is calculated from the index creation time, not the rollover time, so timing can be confusing.

**Too many small indexes being created:** If rollover triggers too frequently, you're creating indexes faster than you can manage them. Increase the size threshold or add an age threshold to require both conditions. This prevents rollover from creating tiny indexes when write volume spikes.

### Conclusion

Index State Management in OpenSearch solves a real operational problem: automating the lifecycle of your indexes based on age, size, or count, enabling cost-effective, scalable data management. By defining policies once and applying them consistently across your infrastructure, you eliminate manual, error-prone index management while optimizing storage costs.

ISM policies give you fine-grained control over how data flows through your cluster. You can implement sophisticated tiering strategies—hot for fast queries, warm for occasional access, UltraWarm for compliance—without writing custom automation code. For organizations managing large volumes of time-series data, ISM is a game-changer.

Start with a simple policy, test it thoroughly on non-production data, then expand to more complex patterns as you gain confidence. Monitor your policies actively, document your decisions, and iterate based on your specific workload characteristics. With ISM in place, index lifecycle management becomes a solved problem, letting you focus on extracting value from your data rather than maintaining the infrastructure that stores it.
