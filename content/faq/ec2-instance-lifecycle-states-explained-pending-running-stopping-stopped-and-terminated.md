---
title: "EC2 Instance Lifecycle States Explained: Pending, Running, Stopping, Stopped, and Terminated"
---

## EC2 Instance Lifecycle States Explained: Pending, Running, Stopping, Stopped, and Terminated

Every EC2 instance you launch follows a predictable lifecycle, moving through distinct states as it starts up, runs, and eventually shuts down. Understanding these states is far more than academic knowledge—it's essential for building reliable infrastructure, managing costs effectively, and troubleshooting production issues. In this article, we'll explore each state in detail, examine what happens to your data and resources during transitions, and clarify the practical differences between operations like stop, reboot, and terminate that developers often confuse.

### The Five Core Instance States

When you work with EC2 instances, they exist in one of five states at any given moment. Think of these states as checkpoints in the instance's lifecycle, each with distinct characteristics and implications for your workload and your bill.

**Pending** is the brief moment after you launch an instance but before it's fully ready to accept traffic. During this phase, AWS is allocating the underlying host resources, initializing the hypervisor, booting the operating system, and running any startup scripts you've configured. Your instance doesn't have an IPv4 address yet, and you can't connect to it. This state typically lasts only a few seconds to a minute, though it can occasionally take longer if capacity is constrained. You're not billed for compute during pending, which is important to note if you're tracking costs carefully.

**Running** is the state where your instance is fully operational and ready for work. The operating system is booted, network connectivity is established, and your application code can execute normally. The instance has been assigned a public IPv4 address if you requested one, and a private IPv4 address within your VPC. This is the only state where you incur charges for compute resources, though you're also paying for any associated EBS volumes regardless of whether the instance is running or stopped. In running state, you can connect via SSH (for Linux) or RDP (for Windows), install software, and serve traffic to your users.

**Stopping** is a transitory state that occurs after you've issued a stop command but before the instance fully shuts down. Think of it like a graceful shutdown in progress. The instance is still present in your account and on your AWS bill, but it's in the process of halting its operations. This state is typically very brief, lasting a few seconds in most cases. It's worth noting that you can't connect to an instance that's in stopping state—it's already on its way down.

**Stopped** is where your instance sits after a clean shutdown. The operating system is no longer running, but the instance itself hasn't been deleted. Your EBS root volume and any additional EBS volumes remain intact with all their data, ready to be reattached when the instance restarts. The instance retains its instance ID, private IP address, and any elastic IP addresses you've associated with it. However, any public IPv4 address assigned during launch will be released, and a new one will be assigned when you start the instance again. Critically, you do not pay for compute resources while stopped, but you continue to pay for any EBS storage attached to the instance.

**Terminated** is the final state from which an instance cannot recover. When an instance is terminated, it's deleted entirely. The instance ID still appears in your console for a short while before disappearing completely, but the instance itself is gone. By default, the root EBS volume is deleted when the instance terminates, though you can configure this behavior. Any instance store volumes are definitely deleted—their data is lost forever. You stop incurring charges for both compute and the root volume, though any additional EBS volumes that weren't configured for deletion will persist and continue to accrue storage costs.

### What Happens to Your Data and Resources During State Transitions

Understanding state transitions requires knowing what happens to the various resources attached to your instance. This is where things get nuanced and where many developers make costly mistakes.

When an instance transitions from pending to running, AWS assigns it a public IPv4 address (if you've enabled one for your subnet and launched with public IP assignment enabled). This address is ephemeral by default, meaning it's only valid while the instance is running. If you stop and then start the instance, you'll get a different public IP. If you need a consistent IP address across stop/start cycles, you should use an Elastic IP address, which remains associated with your instance regardless of state transitions.

EBS volumes tell a different story. When you stop an instance, all EBS volumes remain attached and retain all their data. The data on these volumes is not lost—EBS storage is persistent and independent of the instance lifecycle. When you start the instance again, it will boot from the same root volume with all your OS configuration and data intact. This is what makes EBS volumes so valuable for stateful applications.

Instance store volumes, by contrast, behave very differently. Instance store provides temporary block storage that's physically attached to the host machine running your instance. When your instance stops, instance store data is erased. More dramatically, if the underlying host hardware fails, instance store data is lost immediately. When an instance starts after being stopped, the instance store is presented as empty block storage. This is why instance store is only suitable for temporary data like caches, temporary files, or data that's replicated elsewhere.

Consider a practical scenario: you've launched a web application on an m5.large instance with a 30 GB EBS root volume. You use instance store for temporary uploads that your application processes and deletes. You stop the instance to save on compute costs while you're investigating a development issue. Your EBS volume retains everything—the OS, all installed packages, configuration files, and application data. The instance store is wiped clean. When you start the instance again, you're back to exactly where you left off, except any temporary files in instance store are gone.

### Stop Versus Stop-Hibernate Versus Reboot Versus Terminate

These four operations might seem similar on the surface, but they have dramatically different effects on your instance and its data.

**Stop** performs a graceful shutdown. Your operating system shuts down cleanly, all EBS volumes are flushed and detached (logically), and the instance moves to stopped state. You're no longer charged for compute, but you continue paying for EBS storage. When you start the instance again, it goes through a normal boot process, running through the BIOS, bootloader, kernel initialization, and all startup services. This typically takes 30 seconds to a couple of minutes depending on your OS and configuration. The instance will have a new public IPv4 address (unless you're using an Elastic IP), but all your data on EBS is intact.

**Stop-Hibernate** is a specialized variant that's gaining more popularity as organizations focus on cost optimization. Instead of simply shutting down, stop-hibernate performs a complete memory dump to the EBS root volume before stopping. When you later start the instance, the memory state is restored from that dump, allowing your instance to resume without going through a full boot sequence. This means your application processes can resume without restarting—active connections might persist, in-memory caches are retained, and everything picks up where it left off. This feature is available on certain instance types (primarily on-demand instances using specific families like t3, m5, and c5) and requires that the root volume be encrypted. The tradeoff is that stop-hibernate takes longer than a regular stop (since the memory dump takes time), and you're paying for the extra EBS space to store that memory image. Stop-hibernate is particularly valuable for stateful applications where a full restart is expensive or undesirable.

**Reboot** performs a soft restart without stopping the instance. The operating system reboots, but the instance never leaves running state. It keeps the same public IPv4 address, maintains all connections (though they'll be briefly interrupted), and continues incurring compute charges throughout. This is useful when you've made kernel-level changes or installed updates that require a restart but you don't want the operational disruption of a full stop and start. A reboot typically takes a minute or two, depending on your OS and the number of services that need to restart.

**Terminate** is the irreversible action. The instance is deleted, and unless you've taken explicit precautions, the root EBS volume is also deleted. Instance store is definitely gone. You can't get the instance back—you can only launch a new one. You stop paying for compute immediately, and the root volume deletion stops those charges too. However, if you created additional EBS volumes and configured the root volume to persist on termination, those volumes will remain and continue to cost money. This is why accidental terminations are so damaging—they happen instantly and without recovery options.

### Billing Implications Across Instance States

Cost is often the practical concern that brings instance lifecycle management into focus. Many developers are surprised to learn that stopped instances still incur charges.

When an instance is **running**, you pay for compute resources by the second (with a one-minute minimum), plus per-gigabyte-month charges for any EBS volumes attached. If your instance has a 100 GB EBS volume and you run it continuously, you'll pay for 100 GB-months of storage regardless of whether that instance is actively processing data or idle.

When you **stop** an instance, compute charges cease immediately. However, EBS charges continue. That 100 GB volume still costs you money every month. The only way to stop paying for EBS storage is to detach the volume or delete it. This is where many cost-optimization strategies focus—stopping instances during off-hours (like development environments) while keeping the EBS volumes attached so that when you start the instance again, all your data is exactly as you left it.

**Stopped instances** with EBS storage represent a sweet spot for cost optimization. You save 100% on compute, but you retain all your data and configurations for the small cost of storage. For a development instance that costs $50/month to run but only $5/month to store, this is a compelling economics case. Multiply that across dozens of development instances and you're looking at significant savings.

If you use **stop-hibernate**, you're paying the same compute and storage costs while stopped as a regular stop (you don't pay extra), but the memory dump does consume additional EBS space. You might need a slightly larger root volume to accommodate the memory image, so there's a small storage cost increase.

When an instance is **terminated**, compute charges end immediately. The root volume is deleted by default, so those charges end too. However, if you've explicitly configured the root volume's DeleteOnTermination attribute to false (which you might do to preserve data), it persists and continues accruing storage charges.

### Preventing Accidental Termination

Termination is permanent and quick, which makes accidental termination a serious concern for production systems. AWS provides two mechanisms to protect against this scenario.

**Termination Protection** is a simple boolean flag you can set on an instance through the console or CLI. When enabled, the instance cannot be terminated through the console, CLI, or API—any attempt to terminate will fail with an authorization error. You can enable it like this:

```bash
aws ec2 modify-instance-attribute --instance-id i-1234567890abcdef0 --no-disable-api-termination
```

The flag name is confusingly inverted (it's `no-disable-api-termination` to enable protection), but the intent is clear. Once enabled, terminating the instance requires first disabling this protection. This adds a safety step that prevents fat-finger mistakes.

The AWS console also makes this highly visible—when you try to terminate an instance with protection enabled, you'll get a clear error message stating that termination protection is active.

**The DisableApiTermination Flag** is essentially the same protection expressed through the API and infrastructure-as-code tools. If you're using CloudFormation, Terraform, or other tools, you can set `DisableApiTermination: true` to prevent termination. This works identically to the console-based termination protection.

In practice, you should enable termination protection on any production instances as a standard practice. The operational overhead of disabling it when you legitimately need to terminate an instance is minimal compared to the disaster of accidentally deleting a critical system. You might even have this as a tag-based requirement—any instance tagged as `environment: production` automatically gets termination protection enabled through automation.

### Practical State Transition Examples

Let's walk through a few real-world scenarios to solidify your understanding.

**Scenario 1: Deploying a New Version**

You have a running production instance hosting your application. You've built a new version and want to test it before deploying. You decide to stop the instance, update your application code on the EBS volume while stopped (by detaching it and attaching it to another instance), and then start it again. During the stop, compute charges pause. Your code files and OS configuration on the EBS volume remain intact. When you start it, you get a new public IP (unless you have an Elastic IP), but everything else is identical. The instance goes through pending state briefly, then running state. This entire operation costs you nothing in lost data—the EBS persistence means you maintain your system state.

**Scenario 2: Development Instance Cost Optimization**

You have development instances that your team uses during business hours but that sit idle overnight. You configure a Lambda function to stop all instances tagged with `environment: development` at 6 PM and start them again at 8 AM. During the 14 hours they're stopped, you save on compute costs. The developers arrive the next morning, start the instances, and resume work from exactly where they left off. The cost savings over a month can be substantial without any operational complexity.

**Scenario 3: Emergency Recovery**

A production instance experiences a critical failure. You've investigated and determined it's a corrupted configuration file that requires a reboot to recover from. You issue a reboot command. The instance never leaves running state, keeps its public IP address, and comes back online within a couple of minutes. Your monitoring detects the recovery, and operations is immediately notified. This is much faster and less disruptive than terminating, relaunching, and waiting for boot time.

**Scenario 4: Preventing Disaster**

A junior developer in your organization is deploying infrastructure and accidentally issues a terminate command on what they thought was a test instance but is actually production. Termination protection is enabled, so the API call fails immediately with a clear error message. The developer notices the error, realizes they picked the wrong instance ID, and issues the command against the correct test instance instead. The production system never experienced any disruption. Termination protection just saved your company from an outage.

### Monitoring and Automation Around Instance States

In real AWS environments, you're rarely managing instances manually. Tools like Auto Scaling Groups handle instance lifecycle automatically, responding to load by launching new instances and terminating old ones. CloudWatch can monitor state transitions, triggering alarms or Lambda functions when instances enter unexpected states. EventBridge can capture EC2 state-change events and route them to SNS topics, logging systems, or custom Lambda functions for automation.

Understanding the underlying state machine is essential for working effectively with these automation tools. When you set up Auto Scaling Group termination policies, you're essentially configuring which instances transition to terminated state under specific conditions. When you configure CloudWatch alarms based on instance state, you're monitoring these transitions.

### Conclusion

The EC2 instance lifecycle might seem like a simple progression from launch to termination, but the nuances of each state, the implications for your data and billing, and the strategic choices you make around stopping, rebooting, and terminating instances have enormous practical impact on cost, reliability, and operational efficiency. Stopped instances provide a powerful mechanism for cost optimization without losing your system state. Termination protection prevents accidents. Understanding what happens to EBS volumes versus instance store during each transition guides your architectural decisions. And grasping the differences between reboot, stop, stop-hibernate, and terminate ensures you choose the right operation for each situation.

As you build on AWS, you'll encounter scenarios where these distinctions matter deeply—whether you're optimizing costs for development environments, designing recovery procedures for production systems, or simply preventing accidental disasters. Master the lifecycle, and you master a fundamental aspect of EC2 operations.
