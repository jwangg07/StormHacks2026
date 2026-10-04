import {
  gameInputSchema,
  type GameInput,
  type OpponentInputPayload,
  type RtcSignal,
} from '@wb/core';
import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { MatchAssignment } from './MultiplayerProvider';

const iceServerUrl = import.meta.env.VITE_ICE_SERVER_URL as string | undefined;

export function usePeerPoseTransport(
  socket: Socket,
  assignment: MatchAssignment | null,
  receive: (payload: OpponentInputPayload) => void,
) {
  const channelRef = useRef<RTCDataChannel | null>(null);
  const receiveRef = useRef(receive);
  useEffect(() => {
    receiveRef.current = receive;
  }, [receive]);

  useEffect(() => {
    if (!assignment || typeof RTCPeerConnection === 'undefined') return;
    const peer = new RTCPeerConnection({
      iceServers: iceServerUrl ? [{ urls: iceServerUrl }] : [],
    });
    const pendingCandidates: RTCIceCandidateInit[] = [];
    let started = false;

    const attachChannel = (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.onmessage = ({ data }) => {
        if (typeof data !== 'string') return;
        try {
          const parsed = gameInputSchema.safeParse(JSON.parse(data));
          if (!parsed.success || parsed.data.matchId !== assignment.matchId) return;
          receiveRef.current({
            seat: assignment.seat === 'A' ? 'B' : 'A',
            input: parsed.data,
            serverTimestamp: Date.now(),
          });
        } catch {
          // An unreliable visual packet may be malformed or truncated; ignore it.
        }
      };
      channel.onclose = () => {
        if (channelRef.current === channel) channelRef.current = null;
      };
    };

    const sendSignal = (signal: Omit<RtcSignal, 'matchId'>) =>
      socket.emit('rtc.signal', { matchId: assignment.matchId, ...signal });

    peer.onicecandidate = ({ candidate }) => {
      if (candidate)
        sendSignal({
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            usernameFragment: candidate.usernameFragment,
          },
        });
    };
    peer.ondatachannel = ({ channel }) => attachChannel(channel);

    const start = async ({ matchId }: { matchId: string }) => {
      if (matchId !== assignment.matchId || assignment.seat !== 'A' || started) return;
      started = true;
      attachChannel(peer.createDataChannel('pose', { ordered: false, maxRetransmits: 0 }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.localDescription)
        sendSignal({
          description: { type: 'offer', sdp: peer.localDescription.sdp ?? '' },
        });
    };

    const signal = async (next: RtcSignal) => {
      if (next.matchId !== assignment.matchId) return;
      if (next.description) {
        await peer.setRemoteDescription(next.description);
        for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
        if (next.description.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          if (peer.localDescription)
            sendSignal({
              description: { type: 'answer', sdp: peer.localDescription.sdp ?? '' },
            });
        }
      } else if (next.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(next.candidate);
        else pendingCandidates.push(next.candidate);
      }
    };

    socket.on('rtc.start', start);
    socket.on('rtc.signal', signal);
    socket.emit('rtc.ready', { matchId: assignment.matchId });
    return () => {
      socket.off('rtc.start', start);
      socket.off('rtc.signal', signal);
      channelRef.current?.close();
      channelRef.current = null;
      peer.close();
    };
  }, [assignment, socket]);

  return useCallback((input: GameInput) => {
    const channel = channelRef.current;
    if (channel?.readyState !== 'open') return false;
    channel.send(JSON.stringify(input));
    return true;
  }, []);
}
