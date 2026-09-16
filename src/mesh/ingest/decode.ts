import { createDecipheriv } from 'node:crypto'

import { fromBinary } from '@bufbuild/protobuf'
import { Mesh, Mqtt, Portnums } from '@meshtastic/protobufs'

import { decodePayload } from '#src/mesh/ingest/payloads'
import { type MeshPacket, MeshPacketSchema } from '#src/mesh/ingest/schema'
import { parseNodeId } from '#src/mesh/nodeId'

type DropReason =
    | 'malformed_envelope'
    | 'not_encrypted'
    | 'undecryptable'
    | 'unsupported_payload'
    | 'invalid_packet'

export type DecodeResult =
    | { readonly ok: true; readonly packet: MeshPacket }
    | { readonly ok: false; readonly reason: DropReason }

const drop = (reason: DropReason): DecodeResult => ({ ok: false, reason })

/**
 * Meshtastic's AES-CTR nonce: the packet ID as a little-endian uint64, then
 * the sender node number as a little-endian uint32, then four zero bytes.
 */
function nonceFor(packetId: number, fromNodeNum: number): Buffer {
    const nonce = Buffer.alloc(16)
    nonce.writeUInt32LE(packetId, 0)
    nonce.writeUInt32LE(fromNodeNum, 8)
    return nonce
}

export function meshCrypt(
    key: Buffer,
    packetId: number,
    fromNodeNum: number,
    bytes: Uint8Array
): Buffer {
    const algorithm = key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr'
    const decipher = createDecipheriv(algorithm, key, nonceFor(packetId, fromNodeNum))
    return Buffer.concat([decipher.update(bytes), decipher.final()])
}

function tryParse<T>(parse: () => T): T | undefined {
    try {
        return parse()
    } catch {
        return undefined
    }
}

/**
 * Turns one MQTT message into a validated packet, or says why it was dropped.
 * Plaintext packets are rejected: the channel key is part of our security.
 */
export function decodeEnvelope(bytes: Uint8Array, channelKey: Buffer): DecodeResult {
    const envelope = tryParse(() => fromBinary(Mqtt.ServiceEnvelopeSchema, bytes))
    const packet = envelope?.packet
    const gatewayNodeNum = parseNodeId(envelope?.gatewayId ?? '')
    if (envelope === undefined || packet === undefined || gatewayNodeNum === undefined) {
        return drop('malformed_envelope')
    }
    if (packet.payloadVariant.case !== 'encrypted') return drop('not_encrypted')

    const plaintext = meshCrypt(channelKey, packet.id, packet.from, packet.payloadVariant.value)
    const data = tryParse(() => fromBinary(Mesh.DataSchema, plaintext))
    // A wrong key yields noise that usually fails to parse or has no port.
    if (data === undefined || data.portnum === Portnums.PortNum.UNKNOWN_APP) {
        return drop('undecryptable')
    }

    const payload = tryParse(() => decodePayload(data))
    if (payload === undefined) return drop('unsupported_payload')

    const heardDirectly = packet.hopStart > 0 && packet.hopStart === packet.hopLimit
    const result = MeshPacketSchema.safeParse({
        gatewayNodeNum,
        fromNodeNum: packet.from,
        packetId: packet.id,
        direct:
            heardDirectly && packet.from !== gatewayNodeNum
                ? {
                      snr: packet.rxSnr,
                      rssi:
                          packet.rxRssi === undefined || packet.rxRssi === 0 ? null : packet.rxRssi,
                  }
                : null,
        payload,
    })
    return result.success ? { ok: true, packet: result.data } : drop('invalid_packet')
}
