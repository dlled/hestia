import { type HomeIngestionEvent, HomeIngestionEventSchema, NatsSubjects } from "@hestia/contracts";
import { AckPolicy, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";

const STREAM_NAME = "HESTIA_ENTITY_STATE";
const STREAM_SUBJECT = "home.*.entity.*.state.changed";
const TOPOLOGY_SUBJECT = "home.*.topology.discovered";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EventSubscription {
  close(): Promise<void>;
}

export interface EntityEventPublisher {
  publish(event: HomeIngestionEvent): Promise<void>;
  close(): Promise<void>;
}

export interface EntityEventSubscriber {
  subscribe(
    durableName: string,
    handler: (event: HomeIngestionEvent) => Promise<void>,
    onError?: (error: unknown) => void,
  ): Promise<EventSubscription>;
  close(): Promise<void>;
}

export interface EntityEventBus extends EntityEventPublisher, EntityEventSubscriber {}

export function createInMemoryEntityEventBus(): EntityEventBus {
  const handlers = new Set<(event: HomeIngestionEvent) => Promise<void>>();
  return {
    async publish(input) {
      const event = HomeIngestionEventSchema.parse(input);
      await Promise.all([...handlers].map((handler) => handler(event)));
    },
    async subscribe(_durableName, handler, _onError) {
      handlers.add(handler);
      return {
        async close() {
          handlers.delete(handler);
        },
      };
    },
    async close() {
      handlers.clear();
    },
  };
}

export async function createNatsEntityEventBus(servers: string): Promise<EntityEventBus> {
  const connection = await connect({ servers });
  await ensureStream(connection);
  const client = jetstream(connection);

  return {
    async publish(input) {
      const event = HomeIngestionEventSchema.parse(input);
      const subject =
        event.eventType === "home.entity.state.changed"
          ? NatsSubjects.entityStateChanged(event.homeId, event.subject.entityId)
          : NatsSubjects.topologyDiscovered(event.homeId);
      await client.publish(subject, encoder.encode(JSON.stringify(event)), {
        msgID: event.eventId,
      });
    },
    async subscribe(durableName, handler, onError) {
      const manager = await jetstreamManager(connection);
      const consume = async (name: string, filterSubject: string) => {
        try {
          await manager.consumers.info(STREAM_NAME, name);
        } catch {
          await manager.consumers.add(STREAM_NAME, {
            durable_name: name,
            ack_policy: AckPolicy.Explicit,
            filter_subject: filterSubject,
          });
        }
        const consumer = await client.consumers.get(STREAM_NAME, name);
        return consumer.consume({
          callback: (message) => {
            void Promise.resolve()
              .then(() => HomeIngestionEventSchema.parse(JSON.parse(decoder.decode(message.data))))
              .then(handler)
              .then(() => message.ack())
              .catch((error) => {
                onError?.(error);
                message.nak(1_000);
              });
          },
        });
      };
      const [entityMessages, topologyMessages] = await Promise.all([
        consume(durableName, STREAM_SUBJECT),
        consume(`${durableName}-topology`, TOPOLOGY_SUBJECT),
      ]);
      return {
        async close() {
          entityMessages.stop();
          topologyMessages.stop();
        },
      };
    },
    async close() {
      await connection.drain();
    },
  };
}

async function ensureStream(connection: NatsConnection): Promise<void> {
  const manager = await jetstreamManager(connection);
  let info: Awaited<ReturnType<typeof manager.streams.info>>;
  try {
    info = await manager.streams.info(STREAM_NAME);
  } catch {
    await manager.streams.add({
      name: STREAM_NAME,
      subjects: [STREAM_SUBJECT, TOPOLOGY_SUBJECT],
      duplicate_window: 120_000_000_000,
    });
    return;
  }
  const requiredSubjects = [STREAM_SUBJECT, TOPOLOGY_SUBJECT];
  if (requiredSubjects.some((subject) => !info.config.subjects?.includes(subject))) {
    await manager.streams.update(STREAM_NAME, {
      subjects: [...new Set([...(info.config.subjects ?? []), ...requiredSubjects])],
    });
  }
}
