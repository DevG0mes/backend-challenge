import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

export interface ReceivedSqsMessage {
  body: string;
  receiptHandle: string;
  receiveCount: number;
}

export interface SqsTransport {
  receiveOne(): Promise<ReceivedSqsMessage | null>;
  acknowledge(message: ReceivedSqsMessage): Promise<void>;
  retry(message: ReceivedSqsMessage): Promise<void>;
  moveToDlq(message: ReceivedSqsMessage): Promise<void>;
}

export class AwsSqsClient implements SqsTransport {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly dlqUrl: string,
  ) {}

  async receiveOne(): Promise<ReceivedSqsMessage | null> {
    const response = await this.client.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    const message = response.Messages?.[0];
    if (message?.Body === undefined || message.ReceiptHandle === undefined) return null;
    return {
      body: message.Body,
      receiptHandle: message.ReceiptHandle,
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
    };
  }

  async acknowledge(message: ReceivedSqsMessage): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.receiptHandle }));
  }

  async retry(message: ReceivedSqsMessage): Promise<void> {
    await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.receiptHandle, VisibilityTimeout: 0 }));
  }

  async moveToDlq(message: ReceivedSqsMessage): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.dlqUrl,
      MessageBody: message.body,
      MessageGroupId: 'wager-errors',
    }));
    await this.acknowledge(message);
  }
}
