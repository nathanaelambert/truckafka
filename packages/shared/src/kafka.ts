import { Kafka, type Producer, type Consumer, type EachMessagePayload } from 'kafkajs';
import { KafkaTopics, type KafkaTopic } from './types.js';

export const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || 'truckmafia',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:29092').split(','),
  retry: {
    initialRetryTime: 2000,
    retries: 10,
  },
});

let producerInstance: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (!producerInstance) {
    producerInstance = kafka.producer();
    await producerInstance.connect();
  }
  return producerInstance;
}

export async function publishEvent<T>(
  topic: KafkaTopic,
  key: string,
  value: T
): Promise<void> {
  const producer = await getProducer();
  await producer.send({
    topic,
    messages: [
      {
        key,
        value: JSON.stringify({
          topic,
          key,
          value,
          timestamp: new Date().toISOString(),
        }),
      },
    ],
  });
}

export async function subscribe(
  topic: KafkaTopic,
  groupId: string,
  handler: (payload: EachMessagePayload) => Promise<void>
): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({ eachMessage: handler });
  return consumer;
}

export { KafkaTopics };
