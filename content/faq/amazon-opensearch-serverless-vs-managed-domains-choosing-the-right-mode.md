---
title: "Amazon OpenSearch Serverless vs Managed Domains: Choosing the Right Mode"
---

## Amazon OpenSearch Serverless vs Managed Domains: Choosing the Right Mode

When you need full-text search, log analytics, or vector similarity search on AWS, Amazon OpenSearch is a natural choice. But the platform offers two distinct operational models: the traditional managed domain approach where you provision and manage clusters, and the newer OpenSearch Serverless architecture that abstracts away infrastructure entirely. This decision isn't trivial—it shapes your operational burden, cost profile, and architectural flexibility. Understanding the fundamental differences between these modes and recognizing which suits your workload will help you build more efficient and maintainable applications.

### The Fundamental Shift: From Provisioning to Consumption

The core tension between these two approaches mirrors a broader trend in cloud computing: moving from capacity planning to consumption-based pricing. With a traditional managed OpenSearch domain, you specify the number and type of data nodes upfront. You're essentially reserving compute capacity, paying for it whether you use it fully or not. OpenSearch Serverless inverts this model entirely. You don't think about nodes at all. Instead, you provision "collections"—logical groupings of data—and pay for consumption in the form of OCUs (OpenSearch Compute Units), which measure actual indexing and search activity.

This distinction matters because it directly affects how you approach scaling, cost management, and operational complexity. A managed domain requires you to predict traffic patterns and adjust node counts when those predictions prove wrong. OpenSearch Serverless automatically scales with your workload, but you need to understand what you're actually paying for.

### Architecture: Collections, OCUs, and Data Organization

To truly appreciate the differences, you need to understand how each mode organizes and processes data.

With a managed OpenSearch domain, you're working with a traditional cluster architecture. You define a domain, specify the number of data nodes (which hold your indexed data), dedicated master nodes (which coordinate the cluster), and optionally, dedicated warm or cold nodes for time-series data. Each node type has a specific role. Data nodes serve search queries and handle indexing. Master nodes manage cluster state. The architecture is familiar if you've worked with Elasticsearch before, because managed OpenSearch is essentially a managed version of that same underlying system.

OpenSearch Serverless reimagines this entirely through collections. A collection is a logical container for your data that doesn't require you to think about underlying compute resources. Behind the scenes, AWS manages the infrastructure. But here's where the abstraction becomes concrete: collections come in different types, each optimized for specific use cases.

Time-series collections are built for high-volume, append-heavy workloads like application logs, metrics, or sensor data. Search collections handle general full-text search scenarios. Vector search collections are purpose-built for semantic search, recommendations, and similarity matching using embedding vectors. Each collection type has different performance characteristics and pricing considerations, and you might maintain multiple collections within the same serverless environment, each optimized for its workload.

The OCU consumption model applies differently across these collection types. For time-series and search collections, you pay for indexing OCUs (the compute required to ingest and process data) and search OCUs (the compute required to serve queries). This separation is powerful because it means a collection that's primarily read-heavy won't burn indexing capacity, and vice versa. Vector search collections work similarly but are optimized for vector operations like ANN (approximate nearest neighbor) queries.

With managed domains, you have much finer-grained control. You can tune shard allocation, adjust thread pool sizes, configure circuit breaker thresholds, and manage replica placement explicitly. This granularity is valuable when you're optimizing for specific performance characteristics or when you need predictable resource consumption.

### Indexing and Search: Control vs. Simplicity

When you create an index in a managed OpenSearch domain, you define how many primary shards it contains and how many replicas. Shards are the horizontal scaling unit—they allow your index to grow beyond what fits on a single node. The number of shards affects indexing speed, query performance, and memory usage. Getting this wrong is a common source of performance problems in managed deployments.

OpenSearch Serverless abstracts shard management away. You don't specify shard counts. AWS handles sharding automatically based on your collection's data volume and query patterns. For many applications, this is liberating—you stop worrying about a dimension that rarely needs adjusting anyway. But you lose explicit control, which means if your use case has unusual requirements, you might find yourself limited by serverless assumptions.

Similarly, OpenSearch Serverless provides built-in vector search capabilities through the vector engine, but the configuration options are simpler. You specify the dimension of your vectors and a distance metric, and the system handles the rest. Managed domains require you to manually configure vector field mappings and can require careful tuning of the HNSW (Hierarchical Navigable Small World) algorithm parameters if you're using older versions—though newer versions of OpenSearch have improved these defaults significantly.

### Pricing: Predictability vs. Variable Costs

This is often where the decision crystallizes for teams. Managed OpenSearch domains charge for compute by the node-hour. An `r6g.xlarge.search` node (a common choice for search workloads) costs a fixed amount per hour, whether you're running 10 queries per second or 10,000. You pay the same whether your cluster is fully saturated or mostly idle.

OpenSearch Serverless pricing is consumption-based. You pay for indexing OCUs and search OCUs in five-minute increments. The formula is straightforward: more indexing activity = higher indexing OCU consumption. More complex or frequent queries = higher search OCU consumption. For workloads with highly variable traffic patterns—think a SaaS application with sporadic data ingestion or a search feature that's sometimes dormant—serverless can be dramatically cheaper. During quiet periods, you're barely paying anything.

But serverless has a minimum provisioned capacity requirement, typically around 4 OCUs, ensuring there's always some baseline cost. And OCU pricing is higher per unit than you might initially expect when comparing directly to managed node pricing. The break-even point depends entirely on your usage patterns.

For cost-sensitive applications with predictable, sustained traffic, a managed domain might be cheaper over a month or year. A steady-state workload that consistently uses 20% of a cluster's capacity costs less on a managed domain than on serverless, because you're "wasting" managed capacity that you'd pay for anyway. But for bursty workloads—where traffic spikes unpredictably or workload intensity varies significantly—serverless usually wins.

### Feature Parity and Limitations

OpenSearch Serverless is still younger than managed domains, and this shows in feature coverage. Managed domains support the full range of OpenSearch plugins and custom analyzers with minimal restrictions. Serverless has limitations: you can't install custom plugins, and some advanced configuration options simply aren't exposed.

Vector search is a good example of this. Both support it, but managed domains give you lower-level control over HNSW parameters and index codec options. Serverless gives you a simpler, more opinionated interface that works well for most use cases but doesn't accommodate unusual requirements.

Security configuration differs too. Managed domains allow you to configure fine-grained access control at the field and document level with more granularity. Serverless uses identity-based access policies and data access controls, which are powerful but operate at a higher level of abstraction.

Cross-cluster search and cross-cluster replication are supported in managed domains but have limited or no support in serverless. If you're building a multi-cluster architecture for disaster recovery or geographic distribution, managed domains are currently your only option.

Monitoring and alerting work differently. Managed domains integrate tightly with CloudWatch and allow you to set up custom dashboards and alerts on virtually any metric. Serverless provides CloudWatch integration for indexing and search OCU consumption, but some lower-level node metrics and shard-level visibility aren't available.

### When Serverless Makes Sense

OpenSearch Serverless shines in scenarios where you can't predict demand or where your workloads are fundamentally variable. If you're building a new application and don't know what traffic will look like, serverless lets you avoid the "guess the cluster size" problem entirely. The system scales automatically, and you pay for what you use.

Development and testing environments benefit enormously from serverless pricing. You can maintain a collection that's used only intermittently and pay very little for its existence. Try doing that with a managed domain—you'd pay full node costs for minimal usage.

Serverless is also a strong choice for workloads with clear, separate use cases that naturally map to different collection types. If you ingest time-series data (logs, metrics) and also need a separate search index for product catalogs or documents, serverless collections let you treat these independently, scaling each according to its actual demand rather than sizing the whole cluster to accommodate the noisiest workload.

Proof-of-concept projects and rapid experimentation favor serverless too. You can stand up a collection in minutes, experiment, and tear it down with minimal cost if it doesn't work out.

### When Managed Domains Still Win

Managed OpenSearch domains are the better choice when you have sustained, predictable workloads with known performance requirements. If your application indexes a steady stream of data and serves consistent query volume, the fixed cost of a managed domain is often lower than serverless pricing for equivalent performance.

Fine-grained tuning is a core strength of managed domains. If your use case has unusual performance requirements—perhaps you need custom analyzers, specialized tokenization, or careful control over replica placement for disaster recovery—managed domains give you the levers to optimize. Serverless assumes reasonable defaults that work for most cases but can't accommodate every edge case.

Cost predictability matters in many enterprise environments. With a managed domain, your monthly OpenSearch costs are essentially fixed. With serverless, usage spikes can cause significant cost variance, which complicates budgeting and might require additional monitoring and controls to avoid surprises.

Feature completeness is another factor. If you're using advanced features like cross-cluster search, custom plugins, or need the full range of security configuration options, managed domains are currently your only option.

Organizations running OpenSearch at scale often find that managed domains offer better economics. Once you're large enough that you need multiple search clusters or have proven, sustained demand, the operational flexibility and cost profile of managed domains become more attractive.

### Making the Decision: A Practical Framework

Rather than viewing this as serverless versus managed, think of it as a spectrum. Your decision should hinge on four key dimensions.

First, consider traffic predictability. If your workload is bursty, unpredictable, or has clear quiet periods, serverless pricing is likely cheaper. If traffic is consistent and you've measured it, managed domains probably win on cost.

Second, assess feature requirements. Do you need fine-grained access control, custom analyzers, or cross-cluster search? Those features push you toward managed domains. If you're happy with serverless defaults, that's a point in serverless's favor.

Third, evaluate operational preferences. Do you want to avoid managing cluster topology, shard allocation, and node types? Serverless removes that cognitive load. If you find optimization through tuning satisfying and your team has deep OpenSearch expertise, managed domains might feel more comfortable.

Fourth, think about scale and growth. Startups and growing applications often benefit from serverless's lack of upfront sizing. Mature applications with predictable, large-scale workloads often shift back to managed domains for cost and control.

### Hybrid Approaches and Migration Paths

You don't necessarily have to commit to one approach permanently. Some organizations use serverless for exploratory work and development, then migrate to managed domains for production workloads once they understand the traffic patterns. Others maintain a small managed domain for core production search while using serverless collections for experimental features or auxiliary workloads.

AWS provides migration tooling to help you move between modes. Snapshots and restore operations work across both architectures, though the process requires planning and testing. If you're considering this path, it's worth setting up both architectures in parallel during your evaluation period to understand the operational differences firsthand.

### Conclusion

Choosing between Amazon OpenSearch Serverless and managed domains isn't about one being objectively better—it's about alignment with your workload characteristics and organizational constraints. Serverless excels at variable, unpredictable workloads and removes the operational burden of cluster management. Managed domains provide cost efficiency for sustained traffic, full feature access, and fine-grained control for organizations that want to optimize deeply.

Start by measuring or estimating your indexing and search patterns honestly. Map your requirements against the feature support of each architecture. Consider your team's comfort with operational complexity. Most importantly, recognize that this isn't a permanent decision. As your application evolves, revisiting this choice makes sense. Build with the mode that fits your current state, and remain open to the possibility that your needs—and therefore your ideal architecture—might change as you grow.
