---
title: "Route 53 Private Hosted Zones: Configuration and Use Cases"
---

## Route 53 Private Hosted Zones: Configuration and Use Cases

When you're building applications inside Amazon VPCs, you need a reliable way to resolve DNS names for your internal resources. Public DNS services work fine if you want the whole world to know about your services, but that's rarely the goal inside a private network. This is where Route 53 private hosted zones shine. They let you maintain complete control over DNS resolution for your internal domains, keeping your infrastructure private while providing the same powerful Route 53 features you'd use for public DNS. Whether you're orchestrating microservices, managing databases, or connecting multiple VPCs, understanding private hosted zones is essential for building scalable, maintainable infrastructure.

### Understanding Private Hosted Zones

A private hosted zone is a Route 53 resource that holds DNS records for a domain that you don't want exposed to the public internet. Instead of being answerable by Route 53's public name servers, a private hosted zone is only accessible from within the VPCs you explicitly associate with it. Think of it like a private phone directory for your organization—everyone inside the company can look up phone numbers, but people outside the company can't.

The fundamental difference between a private and public hosted zone comes down to visibility. When you create a public hosted zone, Route 53 assigns four public name servers that anyone with internet connectivity can query. A private hosted zone, by contrast, is resolved by Route 53 Resolver running within your VPCs. This resolver is a managed service that AWS provides automatically in every VPC—you don't have to deploy or manage anything. When an EC2 instance, Lambda function, or container inside your VPC performs a DNS lookup, the VPC's resolver first checks if there's a matching record in any associated private hosted zones before falling back to public DNS resolution.

### Prerequisites: Enabling DNS Support in Your VPC

Before you can use private hosted zones effectively, your VPC must have two DNS-related settings enabled. These are so fundamental that they're often overlooked, but without them, private hosted zones won't work at all.

The first setting is **DNS support**, controlled by the `enableDnsSupport` attribute. This tells the VPC to provide a DNS resolver for your instances. Without it enabled, your instances won't be able to resolve any DNS names at all. The second setting is **DNS hostnames**, controlled by `enableDnsHostnames`. This determines whether instances launched in your VPC receive public DNS hostnames if they're assigned public IP addresses. More importantly for private hosted zones, it ensures that the VPC resolver is fully functional.

You can enable both settings through the AWS Console, or you can use the AWS CLI:

```bash
aws ec2 modify-vpc-attribute \
  --vpc-id vpc-12345678 \
  --enable-dns-support

aws ec2 modify-vpc-attribute \
  --vpc-id vpc-12345678 \
  --enable-dns-hostnames
```

Most VPCs created through the Console have these settings enabled by default, but if you're creating VPCs programmatically or working with older infrastructure, it's worth verifying. You can check the current state with:

```bash
aws ec2 describe-vpc-attribute \
  --vpc-id vpc-12345678 \
  --attribute dnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id vpc-12345678 \
  --attribute dnsHostnames
```

Once you've verified these settings, your VPC is ready to work with private hosted zones.

### Creating and Associating Private Hosted Zones

Creating a private hosted zone is straightforward, but understanding the association model is crucial. When you create a private hosted zone, you immediately associate it with one or more VPCs. This association determines which VPCs can resolve records in that zone.

Let's walk through creating a private hosted zone for an internal microservices domain. Suppose you're running services in a VPC and want to use the domain `internal.example.com` for internal DNS resolution:

```bash
aws route53 create-hosted-zone \
  --name internal.example.com \
  --hosted-zone-config PrivateZone=true \
  --vpc VPCRegion=us-east-1,VPCId=vpc-12345678 \
  --caller-reference "$(date +%s)"
```

The `--vpc` parameter specifies the VPC to associate with the zone. The region and VPC ID are both required. The `--caller-reference` is a unique identifier that AWS uses to prevent duplicate zone creation if you retry the request.

After creation, you'll receive a response containing the hosted zone ID, which you'll use to add records to the zone. This ID looks something like `Z1234567890ABC`.

Now, if you want to add another VPC to the same private hosted zone—perhaps in a different region or a different account—you use the associate operation:

```bash
aws route53 associate-vpc-with-hosted-zone \
  --hosted-zone-id Z1234567890ABC \
  --vpc VPCRegion=us-west-2,VPCId=vpc-87654321
```

This is powerful for multi-region deployments or scenarios where you have multiple VPCs that need to share internal DNS. You can associate up to ten VPCs per private hosted zone by default, though you can request a limit increase if needed.

### Adding Records to Your Private Hosted Zone

Once your private hosted zone exists and is associated with your VPCs, you add DNS records just like you would in a public zone. You can create A records, AAAA records, CNAME records, MX records, and more. Here's an example of adding an A record for a database endpoint:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "db.internal.example.com",
          "Type": "A",
          "TTL": 300,
          "ResourceRecords": [
            {
              "Value": "10.0.1.42"
            }
          ]
        }
      }
    ]
  }'
```

Now, any instance in an associated VPC can resolve `db.internal.example.com` to the IP address `10.0.1.42`. This is perfect for database endpoints, load balancers, or any other internal service that needs a stable, memorable DNS name.

If you're working with dynamic endpoints—like those managed by Elastic Load Balancing or Amazon RDS—you might want to use alias records instead. Alias records are Route 53-specific and point to AWS resources directly, with automatic updates if the underlying resource changes:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "api.internal.example.com",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "Z35SXDOTRQ7X7K",
            "DNSName": "my-alb-123456.us-east-1.elb.amazonaws.com",
            "EvaluateTargetHealth": true
          }
        }
      }
    ]
  }'
```

Alias records are excellent for internal load balancers because they automatically track changes without requiring manual updates.

### Split-Horizon DNS: Public and Private Views of the Same Domain

One of the most elegant patterns you can implement with Route 53 is split-horizon DNS, which allows you to maintain separate DNS views for the same domain. Your internal services resolve to private IP addresses when accessed from inside your VPCs, while external clients see public IP addresses when they query the public DNS.

Imagine you have a web service running on both internal and external infrastructure. Internally, you want `api.example.com` to resolve to the private load balancer at `10.0.2.15`. Externally, you want the same domain to resolve to the public load balancer at `203.0.113.42`.

To implement this, you create two hosted zones: one public and one private, both for the domain `example.com`. In the public zone, you add the record that points to your public resources. In the private zone, associated with your internal VPCs, you add the record that points to your private resources.

When an EC2 instance inside your VPC performs a DNS lookup for `api.example.com`, the VPC resolver checks the private hosted zone first and returns the private IP. When an external client performs the same lookup, they get a response from the public name servers, resolving to the public IP. The beauty of this approach is that your internal code doesn't need to know about separate internal and external domain names—everything uses the same domain name, but gets the appropriate address based on where the lookup originates.

### Cross-Account VPC Association

As your infrastructure grows across multiple AWS accounts, you'll often need to share private hosted zones across account boundaries. Route 53 supports this through cross-account VPC association, though the process requires some careful coordination.

The fundamental pattern is that the account owning the hosted zone must authorize VPCs from other accounts to associate with it. This is done through the `AssociateVPCWithHostedZone` API call from the account owning the VPC, but only after the zone owner has explicitly allowed it.

Here's how it works in practice. Let's say account A owns the private hosted zone, and account B owns the VPC that needs to be associated. First, the zone owner in account A creates the zone (which we've already covered). Then, to allow account B's VPC to associate, they need an IAM policy in account A that permits this action. However, the more practical approach is to use Route 53 APIs with cross-account authorization.

From the VPC owner's account (account B), you attempt to associate the VPC with the hosted zone:

```bash
aws route53 associate-vpc-with-hosted-zone \
  --hosted-zone-id Z1234567890ABC \
  --vpc VPCRegion=us-east-1,VPCId=vpc-87654321
```

If the hosted zone owner in account A has an IAM policy that permits this cross-account association, the operation succeeds. If not, it fails, and the zone owner needs to grant permission through their account's IAM configuration.

In practice, many organizations handle this through Infrastructure as Code, using AWS CloudFormation or Terraform to manage the IAM policies and associations across accounts. The key takeaway is that cross-account VPC association is fully supported, but it requires explicit permission from the zone owner.

### Microservice Discovery Patterns

Private hosted zones are particularly valuable in microservice architectures, where you need reliable, simple service discovery. Instead of maintaining complex service discovery platforms, you can leverage Route 53 to build a straightforward service registry.

Consider a typical microservices deployment where you have multiple replicas of each service across different subnets. Your authentication service might have three instances running in separate availability zones. You create A records in your private hosted zone for `auth.internal.example.com`, each pointing to one of the three instance IP addresses:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "auth.internal.example.com",
          "Type": "A",
          "TTL": 60,
          "ResourceRecords": [
            {"Value": "10.0.1.10"},
            {"Value": "10.0.2.10"},
            {"Value": "10.0.3.10"}
          ]
        }
      }
    ]
  }'
```

When your application code connects to `auth.internal.example.com`, the VPC resolver returns all three IPs, and your client library performs client-side load balancing across them. This is simple, requires no additional infrastructure, and leverages Route 53's managed service.

For containerized workloads, you can automate this process by running Lambda functions that listen to events from EC2 or ECS and update Route 53 records accordingly. This creates a dynamic service registry that stays in sync with your actual running infrastructure.

A short TTL (time-to-live), like the 60 seconds shown above, ensures that when instances are replaced or replaced, clients quickly discover the changes. However, keep in mind that very short TTLs increase the load on Route 53 Resolver, so you'll want to tune this value based on your application's tolerance for brief disruptions.

### Extending Private DNS to On-Premises Networks

As your infrastructure grows and you establish hybrid deployments connecting your AWS VPCs to on-premises data centers, you'll need a way to extend private DNS resolution to both directions. This is where Route 53 Resolver endpoints become essential.

Route 53 Resolver endpoints allow you to create a bidirectional DNS resolution bridge between your VPCs and on-premises networks. There are two types: inbound and outbound endpoints.

An **inbound Resolver endpoint** allows on-premises systems to query Route 53 private hosted zones. You create the endpoint, which gets an IP address in your VPC, and then configure your on-premises DNS infrastructure to forward queries for your private domains to this endpoint IP. This could be done through your corporate DNS servers or through VPN/Direct Connect connectivity.

An **outbound Resolver endpoint** allows EC2 instances and other VPC resources to resolve on-premises DNS names. You associate the endpoint with a private hosted zone and create forwarding rules that specify which domain names should be forwarded to your on-premises DNS servers.

Setting up an inbound endpoint looks like this:

```bash
aws route53resolver create-resolver-endpoint \
  --name my-inbound-endpoint \
  --type INBOUND \
  --ip-address-subnets SubnetId=subnet-12345678 \
  --security-group-ids sg-12345678 \
  --region us-east-1
```

This creates an endpoint in the specified subnets. You'll get back IP addresses that on-premises systems can use to query your private hosted zones.

For outbound resolution, you create an outbound endpoint and then add forwarding rules:

```bash
aws route53resolver create-resolver-endpoint \
  --name my-outbound-endpoint \
  --type OUTBOUND \
  --ip-address-subnets SubnetId=subnet-12345678 \
  --security-group-ids sg-12345678 \
  --region us-east-1
```

Then, create a forwarding rule to specify how on-premises DNS queries should be handled:

```bash
aws route53resolver create-resolver-rule \
  --creator-request-id "$(date +%s)" \
  --rule-type FORWARD \
  --domain-name corp.example.com \
  --target-ips Ip=192.0.2.10,Port=53 Ip=192.0.2.11,Port=53 \
  --resolver-endpoint-id rslvr-out-12345678
```

This rule says that any query for `corp.example.com` should be forwarded to the specified on-premises DNS servers. You then associate this rule with your VPCs:

```bash
aws route53resolver associate-resolver-rule \
  --resolver-rule-id rslvr-rule-12345678 \
  --vpc-id vpc-12345678
```

With these endpoints and rules in place, your entire hybrid network has seamless, secure DNS resolution. Your VPC-based services can resolve on-premises hostnames, and your on-premises systems can resolve private Route 53 zones, all without exposing anything to the public internet.

### Security Considerations

When working with private hosted zones, keep a few security principles in mind. First, the VPC association itself is your primary access control mechanism. Only instances within associated VPCs can resolve records in the zone. This is enforced at the VPC resolver level, so there's no way for an external attacker to bypass it through DNS queries.

However, if you're using Resolver endpoints to extend resolution to on-premises networks, those networks must be connected via a secure channel like Direct Connect or a VPN tunnel. Never expose Resolver endpoints to the public internet without network-level protection. Always place them in private subnets and use security groups to restrict access to only the networks that need it.

Additionally, if you're managing DNS records programmatically (which many organizations do for dynamic service discovery), ensure that the IAM policies granting permission to modify records are tightly scoped. A developer who needs to query DNS shouldn't have permission to create or modify records, and vice versa.

### Real-World Example: Multi-Tier Application Architecture

Let's tie everything together with a realistic example. Imagine you're building a three-tier e-commerce application with a web tier, application tier, and database tier, all running in a VPC with a private hosted zone named `ecommerce.local`.

Your architecture includes:

- An Application Load Balancer in the web tier at `10.0.1.100`
- A cluster of application servers in the app tier at `10.0.2.10`, `10.0.2.11`, and `10.0.2.12`
- An RDS database cluster at `10.0.3.50`

You create the private hosted zone and add records for each tier:

```bash
aws route53 create-hosted-zone \
  --name ecommerce.local \
  --hosted-zone-config PrivateZone=true \
  --vpc VPCRegion=us-east-1,VPCId=vpc-12345678 \
  --caller-reference "$(date +%s)"
```

Add the ALB as an alias record:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "web.ecommerce.local",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z35SXDOTRQ7X7K",
          "DNSName": "my-alb-123456.us-east-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

Add the application servers with a short TTL for dynamic load balancing:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "api.ecommerce.local",
        "Type": "A",
        "TTL": 60,
        "ResourceRecords": [
          {"Value": "10.0.2.10"},
          {"Value": "10.0.2.11"},
          {"Value": "10.0.2.12"}
        ]
      }
    }]
  }'
```

And the database endpoint:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "db.ecommerce.local",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [
          {"Value": "ecommerce-db.c9akciq32.us-east-1.rds.amazonaws.com"}
        ]
      }
    }]
  }'
```

Now your application code can simply connect to `api.ecommerce.local` and `db.ecommerce.local` without worrying about IP addresses or external DNS. When you scale up the application tier by adding new instances, you update the Route 53 records, and traffic automatically distributes to the new instances.

If you later decide to extend this infrastructure to a second region or add on-premises systems, you can associate additional VPCs with the same private hosted zone or set up Resolver endpoints to extend resolution across your entire network, all while maintaining the same simple internal domain names.

### Conclusion

Route 53 private hosted zones provide a simple yet powerful foundation for internal DNS in AWS. By associating private zones with your VPCs and leveraging split-horizon DNS patterns, you can build clean, maintainable internal service discovery without additional infrastructure or complexity. The ability to extend these zones across multiple VPCs, manage them across AWS accounts, and bridge to on-premises networks with Resolver endpoints makes them essential for any organization building multi-tier or hybrid cloud applications.

The key to success is remembering the prerequisites—ensuring DNS support is enabled in your VPCs—and designing your DNS naming scheme thoughtfully from the start. Well-chosen internal domain names become the language your organization uses to talk about infrastructure, making your architecture clearer and easier to manage over time.
