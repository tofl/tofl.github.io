---
title: "Schema Registry on AWS: Using AWS Glue Schema Registry with MSK and Kinesis"
---

# Schema Registry on AWS: Using AWS Glue Schema Registry with MSK and Kinesis

When you're building event-driven architectures on AWS, one of the most common headaches is schema management. Your Kafka producers and Kinesis consumers are generating thousands of events per second, each with its own structure. What happens when you need to add a new field? Remove an old one? Change a data type? Without a centralized way to manage these schemas and validate compatibility, you end up with broken consumers, silent data corruption, or rollback nightmares at 3 AM.

This is where AWS Glue Schema Registry comes in. It's a managed service that sits between your data producers and consumers, providing centralized schema management, compatibility checking, and serialization enforcement. In this article, we'll explore how to use the Glue Schema Registry with Amazon MSK (Managed Streaming for Kafka) and Amazon Kinesis, understand schema evolution rules, and walk through practical code examples that show how to prevent breaking changes in your streaming infrastructure.

### Understanding AWS Glue Schema Registry

AWS Glue Schema Registry is a fully managed service that acts as a central repository for your event schemas. Think of it as version control for your data structure. Rather than having Kafka topics or Kinesis streams with implicit or ad-hoc schemas scattered across your organization, you define schemas once in the registry and reference them by ID from your producers and consumers.

The beauty of this approach is that every message can be tagged with a schema version ID. On the consumer side, the registry automatically validates incoming events against the expected schema before your application even sees them. If a message doesn't conform, you can reject it immediately rather than letting bad data propagate through your pipeline.

The service is entirely free—there's no charge for storing schemas or validating messages, which makes it an attractive option for organizations of any size.

### Supported Schema Formats

Glue Schema Registry supports three major schema definition formats, each with its own strengths. Avro is a compact binary serialization format that's been around since Hadoop days and is deeply integrated with Kafka ecosystems. It offers excellent compression and includes built-in schema evolution support. JSON Schema is the more modern, human-readable choice if you're already using JSON as your event format. It's language-agnostic and easier to inspect by hand. Protobuf, developed by Google, is increasingly popular in microservices architectures because of its efficiency and language support across Java, Python, Go, and beyond.

Choosing the right format depends on your existing infrastructure and team expertise. If you're already running Kafka, Avro is often the natural fit. If your organization is heavily invested in JSON, stick with JSON Schema. Protobuf is excellent if you need strong language-agnostic support and plan to consume events across many different services.

### Schema Compatibility Modes

One of the most powerful aspects of Glue Schema Registry is its support for schema compatibility checking. Before a new schema version is registered, the registry can validate it against previous versions according to rules you define. This prevents incompatibilities from silently breaking your consumers.

**Backward compatibility** means new schema versions can be read by consumers built for older versions. This is useful when you're adding optional fields to your events—old consumers simply ignore the new fields and keep working. In practice, this means you can deploy new producers before updating consumers, which is the deployment pattern most teams prefer. When you add a field, you must provide a default value so that old consumers, unaware of the field, can still construct a valid message.

**Forward compatibility** is the opposite: it means old schema versions can be read by consumers built for newer versions. This is less commonly needed, but it's useful in specific scenarios where you have very long-lived consumers that you can't update frequently. With forward compatibility, you can deploy new consumers that understand a future schema before producers actually start sending that schema. It's relatively restrictive—you can only add fields that don't change how old messages are interpreted.

**Full compatibility** combines both backward and forward compatibility, meaning schema versions can be read by consumers built for both older and newer versions. This is the most restrictive mode but also the safest—you get the maximum flexibility in deployment order and timing. Most teams find that backward compatibility is the sweet spot, offering good flexibility without being overly restrictive.

**No compatibility checking** disables all validation. The registry still stores versions, but it won't prevent incompatible schemas from being registered. This is sometimes useful during development or if you have very specific requirements that don't fit standard patterns, but it largely defeats the purpose of the registry.

### Integration with MSK and Kinesis

When you're using Amazon MSK (Managed Streaming for Kafka), the Glue Schema Registry integrates seamlessly through custom serializers and deserializers. Kafka's producer and consumer APIs let you specify serialization classes, and AWS provides ready-made implementations that handle schema registry lookups automatically. Your producer serializes a message, the custom serializer looks up the schema ID, prepends it to the message, and sends it to the topic. Your consumer's deserializer receives the message, extracts the schema ID, fetches the schema from the registry, and validates before passing the message to your application code.

For Kinesis, the integration is slightly different. Kinesis doesn't have the same pluggable serialization layer that Kafka does, so you manually call the Glue Schema Registry APIs within your producer and consumer code. You still get schema validation and central management, but the implementation is more explicit—you're responsible for putting the schema ID in your record and calling the registry's validate method.

Both approaches let you avoid the "schema on read" problem where different parts of your infrastructure interpret the same data differently. Instead, you're enforcing "schema on write"—the producer must adhere to a registered schema, and the consumer validates against that same schema.

### Working with the Glue Schema Registry: A Practical Example

Let's walk through a concrete example using MSK with Avro schemas. Imagine you're building an e-commerce event pipeline where you need to stream order events.

First, you define your schema in the registry. You'd use the AWS SDK to create a schema:

```python
import boto3

glue = boto3.client('glue', region_name='us-east-1')

schema_definition = """{
  "type": "record",
  "name": "OrderEvent",
  "namespace": "com.example.ecommerce",
  "fields": [
    {"name": "order_id", "type": "string"},
    {"name": "customer_id", "type": "string"},
    {"name": "amount", "type": "double"},
    {"name": "timestamp", "type": "long"}
  ]
}"""

response = glue.create_schema(
    RegistryId={'RegistryName': 'default-registry'},
    SchemaName='OrderEvent',
    DataFormat='AVRO',
    Compatibility='BACKWARD',
    SchemaDefinition=schema_definition
)

schema_version_id = response['SchemaVersionId']
print(f"Schema registered with version ID: {schema_version_id}")
```

Now you have a schema in the registry with automatic schema version tracking. Next, you set up a Kafka producer that uses this schema. The Glue libraries provide an Avro serializer that integrates with Kafka:

```python
from confluent_kafka import Producer
from awsglue.schema_registry.confluent_kafka_serde import (
    AvroSerDe,
    GlueSchemaRegistryDeserializer,
    GlueSchemaRegistrySerializer
)

# Create the serializer
serde = AvroSerDe(
    schema_id='<schema-version-id>',
    region='us-east-1'
)

# Create Kafka producer
producer_config = {
    'bootstrap.servers': 'your-msk-cluster.kafka.amazonaws.com:9092',
    'client.id': 'order-producer'
}

producer = Producer(producer_config)

# Prepare and send an event
order_event = {
    'order_id': '12345',
    'customer_id': 'cust-789',
    'amount': 99.99,
    'timestamp': 1672531200
}

# Serialize the event using the schema registry
serialized_message = serde.serialize(order_event)

producer.produce(
    topic='orders',
    value=serialized_message,
    callback=lambda err, msg: print(f"Sent: {err or msg.topic()}")
)

producer.flush()
```

On the consumer side, the deserializer automatically handles schema lookup and validation:

```python
from confluent_kafka import Consumer

consumer_config = {
    'bootstrap.servers': 'your-msk-cluster.kafka.amazonaws.com:9092',
    'group.id': 'order-consumer-group',
    'auto.offset.reset': 'earliest'
}

consumer = Consumer(consumer_config)
consumer.subscribe(['orders'])

serde = AvroSerDe(
    schema_id='<schema-version-id>',
    region='us-east-1'
)

while True:
    msg = consumer.poll(timeout=1.0)
    if msg is None:
        continue
    
    if msg.error():
        print(f"Consumer error: {msg.error()}")
        continue
    
    # Deserialize using schema registry
    try:
        order = serde.deserialize(msg.value())
        print(f"Received order: {order}")
    except Exception as e:
        print(f"Deserialization failed: {e}")
```

### Handling Schema Evolution

Now let's say a month later, you need to add a new field—`shipping_address`—to your order events. You don't want to break existing consumers that don't know about this field yet.

With backward compatibility enabled, you add the field with a default value:

```python
evolved_schema_definition = """{
  "type": "record",
  "name": "OrderEvent",
  "namespace": "com.example.ecommerce",
  "fields": [
    {"name": "order_id", "type": "string"},
    {"name": "customer_id", "type": "string"},
    {"name": "amount", "type": "double"},
    {"name": "timestamp", "type": "long"},
    {"name": "shipping_address", "type": ["null", "string"], "default": null}
  ]
}"""

response = glue.update_schema(
    SchemaId={'SchemaArn': 'arn:aws:glue:us-east-1:123456789012:schema/OrderEvent'},
    SchemaDefinition=evolved_schema_definition
)
```

When you register this new version, Glue's compatibility checker validates it against the previous version. Because the new field has a default value, old consumers can still deserialize messages that include the new field—they'll just use the default and carry on. Meanwhile, you can deploy new producers that populate the shipping address before you've updated all your consumers.

This is the real power of schema registry: it lets you decouple producer and consumer deployments. You don't need to orchestrate synchronized rollouts across your entire infrastructure.

### Cost Considerations and Best Practices

One of the biggest advantages of Glue Schema Registry is that it's completely free. There are no charges for storing schemas, registering versions, or validating messages. Your only cost is the underlying infrastructure—MSK cluster, Kinesis stream, and any EC2 instances running producers and consumers.

From a practical standpoint, this makes it easy to justify using the registry even for smaller teams or experimental projects. You get schema governance without a separate bill.

When designing your schema strategy, organize schemas by domain or business capability. Create separate schemas for different types of events rather than trying to cram everything into a single "Event" schema. This makes it easier to evolve schemas independently and reduces the blast radius when you need to make changes.

Use meaningful names and include descriptive documentation. The registry stores schemas as text, so a clear, well-commented schema definition pays dividends when someone needs to understand the data structure six months later.

For version management, let the registry handle the versioning automatically rather than manually incrementing version numbers. The registry assigns monotonically increasing IDs, which is less error-prone and gives you a clear audit trail of schema evolution.

### Kinesis Integration

While MSK integration happens largely through custom serializers, Kinesis requires a more hands-on approach since Kinesis records are just byte arrays without a serialization framework.

You manually interact with the Glue Schema Registry API:

```python
import boto3
import json
from awsglue.schema_registry.glue_schema_registry_client import GlueSchemaRegistryClient

glue_client = GlueSchemaRegistryClient(region_name='us-east-1')

# Get the schema
schema = glue_client.get_latest_schema_version(
    SchemaId={'SchemaName': 'OrderEvent'}
)

schema_version_id = schema['VersionNumber']

# Validate an event
order_event = {
    'order_id': '12345',
    'customer_id': 'cust-789',
    'amount': 99.99,
    'timestamp': 1672531200
}

is_valid = glue_client.validate_schema(
    DataFormat='AVRO',
    SchemaDefinition=schema['SchemaDefinition'],
    Data=json.dumps(order_event).encode()
)

# Put to Kinesis with schema version ID
kinesis = boto3.client('kinesis', region_name='us-east-1')

record_data = json.dumps(order_event).encode()
kinesis.put_record(
    StreamName='orders',
    Data=record_data,
    PartitionKey='cust-789',
    ExplicitHashKey=None
)
```

On the consumer side, you fetch the schema and validate:

```python
response = kinesis.get_shard_iterator(
    StreamName='orders',
    ShardId='shardId-000000000001',
    ShardIteratorType='TRIM_HORIZON'
)

shard_iterator = response['ShardIterator']

while shard_iterator:
    response = kinesis.get_records(ShardIterator=shard_iterator, Limit=100)
    
    for record in response['Records']:
        data = json.loads(record['Data'].decode())
        
        # Validate against schema
        schema = glue_client.get_latest_schema_version(
            SchemaId={'SchemaName': 'OrderEvent'}
        )
        
        is_valid = glue_client.validate_schema(
            DataFormat='AVRO',
            SchemaDefinition=schema['SchemaDefinition'],
            Data=record['Data']
        )
        
        if is_valid:
            print(f"Valid order event: {data}")
        else:
            print(f"Invalid event, rejecting: {data}")
    
    shard_iterator = response['NextShardIterator']
```

The Kinesis approach gives you less automation than MSK but still provides the central schema governance that prevents data quality issues.

### Monitoring and Troubleshooting

When things go wrong—and they will—Glue Schema Registry integrates with CloudWatch for monitoring. You can track schema registration attempts, validation failures, and version counts. Set up CloudWatch alarms to notify you if validation failures spike, which often indicates that a producer is sending malformed data or a consumer is out of sync.

When a consumer fails to deserialize a message, the error message will tell you whether it's a schema mismatch, a missing field, or an incompatible type. Use these signals to investigate whether a schema version hasn't been properly distributed, whether old code is still running somewhere, or whether there's a genuine data quality issue.

### Conclusion

AWS Glue Schema Registry solves a real, painful problem in event-driven architectures. By providing centralized schema management, compatibility checking, and automatic validation, it lets you evolve your data structures without breaking downstream consumers. Whether you're using MSK for Kafka or Kinesis for a managed streaming service, the registry gives you the guardrails to prevent schema-related outages.

The combination of being free, easy to integrate, and powerful enough for complex scenarios makes it a sensible default choice for AWS-based streaming systems. Start with backward compatibility, name your schemas thoughtfully, and let the registry handle version management. Your future self debugging a data quality issue at midnight will thank you.
