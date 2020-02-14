/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('DOMContentLoaded');
  try {
    const enumerateDevices = await navigator.mediaDevices.enumerateDevices();
    gotSources(enumerateDevices);
  } catch (e) {
    console.log(e);
  }

  const getMediaButton = document.querySelector('button#getMedia');
  const createPeerConnectionButton = document.querySelector('button#createPeerConnection');
  const addAudioTrackButton = document.querySelector('button#addAudioTrack');
  const addVideoTrackButton = document.querySelector('button#addVideoTrack');
  const createOfferButton = document.querySelector('button#createOffer');
  const createAnswerButton = document.querySelector('button#createAnswer');
  const setLocalDescriptionButton = document.querySelector('button#setLocalDescription');
  const setRemoteDescriptionButton = document.querySelector('button#setRemoteDescription');
  const hangupButton = document.querySelector('button#hangup');
  let dataChannelDataReceived;

  getMediaButton.onclick = getMedia;
  createPeerConnectionButton.onclick = createPeerConnection;
  addAudioTrackButton.onclick = addAudioTrack;
  addVideoTrackButton.onclick = addVideoTrack;
  createOfferButton.onclick = createOffer;
  createAnswerButton.onclick = createAnswer;
  setLocalDescriptionButton.onclick = setLocalDescription;
  setRemoteDescriptionButton.onclick = setRemoteDescription;
  hangupButton.onclick = hangup;

  const localSdpTextarea = document.querySelector('div#local textarea');
  const remoteSdpTextarea = document.querySelector('div#remote textarea');

  const audioSelect = document.querySelector('select#audioSrc');
  const videoSelect = document.querySelector('select#videoSrc');

  audioSelect.onchange = videoSelect.onchange = getMedia;

  const localVideo = document.querySelector('div#local video');
  const remoteVideo = document.querySelector('div#remote video');

  const selectSourceDiv = document.querySelector('div#selectSource');

  let pc;
  let localStream;
  let sendChannel;
  let receiveChannel;
  const dataChannelOptions = {ordered: true};
  let dataChannelCounter = 0;
  let sendDataLoop;
  const offerOptions = {
    offerToReceiveAudio: 1,
    offerToReceiveVideo: 1
  };

  function gotSources(sourceInfos) {
    selectSourceDiv.classList.remove('hidden');
    let audioCount = 0;
    let videoCount = 0;
    for (let i = 0; i < sourceInfos.length; i++) {
      const option = document.createElement('option');
      option.value = sourceInfos[i].deviceId;
      option.text = sourceInfos[i].label;
      if (sourceInfos[i].kind === 'audioinput') {
        audioCount++;
        if (option.text === '') {
          option.text = `Audio ${audioCount}`;
        }
        audioSelect.appendChild(option);
      } else if (sourceInfos[i].kind === 'videoinput') {
        videoCount++;
        if (option.text === '') {
          option.text = `Video ${videoCount}`;
        }
        videoSelect.appendChild(option);
      } else {
        console.log('unknown', JSON.stringify(sourceInfos[i]));
      }
    }
  }

  async function getMedia() {
    getMediaButton.disabled = true;
    createPeerConnectionButton.disabled = false;

    if (localStream) {
      localVideo.srcObject = null;
      localStream.getTracks().forEach(track => track.stop());
    }
    const audioSource = audioSelect.value;
    console.log(`Selected audio source: ${audioSource}`);
    const videoSource = videoSelect.value;
    console.log(`Selected video source: ${videoSource}`);

    const constraints = {
      audio: {
        optional: [{
          sourceId: audioSource
        }]
      },
      video: {
        optional: [{
          sourceId: videoSource
        }]
      }
    };
    console.log('Requested local stream');
    try {
      const userMedia = await navigator.mediaDevices.getUserMedia(constraints);
      gotStream(userMedia);
    } catch (e) {
      console.log('navigator.getUserMedia error: ', e);
    }
  }

  function gotStream(stream) {
    console.log('Received local stream');
    localVideo.srcObject = stream;
    localStream = stream;
  }

  function createPeerConnection() {
    createPeerConnectionButton.disabled = true;
    addAudioTrackButton.disabled = false;
    addVideoTrackButton.disabled = false;
    createOfferButton.disabled = false;
    createAnswerButton.disabled = false;
    setLocalDescriptionButton.disabled = false;
    setRemoteDescriptionButton.disabled = false;
    hangupButton.disabled = false;
    console.log('Starting call');
    const servers = null;
    let configuration = { sdpSemantics: "unified-plan" };
    window.pc = pc = new RTCPeerConnection(configuration);
    console.log('Created local peer connection object pc');
    pc.onicecandidate = e => onIceCandidate(pc, e);
    pc.ontrack = gotRemoteStream;
    sendChannel = pc.createDataChannel('sendDataChannel', dataChannelOptions);
    sendChannel.onopen = onSendChannelStateChange;
    sendChannel.onclose = onSendChannelStateChange;
    sendChannel.onerror = onSendChannelStateChange;
  }

  function addAudioTrack()  {
    const audioTracks = localStream.getAudioTracks();

    if (audioTracks.length > 0) {
      console.log(`Using audio device: ${audioTracks[0].label}`);
    }
    localStream.getAudioTracks()
        .forEach(track => pc.addTrack(track.clone(), localStream));
    console.log('Adding audio track to peer connection');
  }

  function addVideoTrack()  {
    const videoTracks = localStream.getVideoTracks();

    if (videoTracks.length > 0) {
      console.log(`Using video device: ${videoTracks[0].label}`);
    }
    localStream.getVideoTracks()
        .forEach(track => pc.addTrack(track.clone(), localStream));
    console.log('Adding video track to peer connection');
  }

  function onSetSessionDescriptionSuccess() {
    console.log('Set session description success.');
  }

  function onSetSessionDescriptionError(error) {
    console.log(`Failed to set session description: ${error.toString()}`);
  }

  async function createOffer() {
    try {
      const offer = await pc.createOffer(offerOptions);
      gotDescription(offer);
    } catch (e) {
      onCreateSessionDescriptionError(e);
    }
  }

  function onCreateSessionDescriptionError(error) {
    console.log(`Failed to create session description: ${error.toString()}`);
  }

  async function setLocalDescription() {
    const sdp = localSdpTextarea.value;
    const description = {
      type: (pc.signalingState == 'stable' ? 'offer' : 'answer'),
      sdp: sdp
    };
    console.log(`Modified Description from pc\n${sdp}`);

    try {
      // eslint-disable-next-line no-unused-vars
      const ignore = await pc.setLocalDescription(description);
      onSetSessionDescriptionSuccess();
    } catch (e) {
      onSetSessionDescriptionError(e);
    }
  }

  async function setRemoteDescription() {
    const sdp = remoteSdpTextarea.value;
    const description = {
      type: (pc.signalingState == 'stable' ? 'offer' : 'answer'),
      sdp: sdp
    };
    console.log(`Remote Description\n${sdp}`);

    try {
      // eslint-disable-next-line no-unused-vars
      const ignore = await pc.setRemoteDescription(description);
      onSetSessionDescriptionSuccess();
    } catch (e) {
      onSetSessionDescriptionError(e);
    }
  }

  function gotDescription(description) {
    localSdpTextarea.disabled = false;
    localSdpTextarea.value = description.sdp;
  }

  async function createAnswer() {
    // Since the 'remote' side has no media stream we need
    // to pass in the right constraints in order for it to
    // accept the incoming offer of audio and video.
    try {
      const answer = await pc.createAnswer();
      gotDescription(answer);
    } catch (e) {
      onCreateSessionDescriptionError(e);
    }
  }

  function sendData() {
    if (sendChannel.readyState === 'open') {
      sendChannel.send(dataChannelCounter);
      console.log(`DataChannel send counter: ${dataChannelCounter}`);
      dataChannelCounter++;
    }
  }

  function hangup() {
    remoteVideo.srcObject = null;
    console.log('Ending call');
    localStream.getTracks().forEach(track => track.stop());
    sendChannel.close();
    if (receiveChannel) {
      receiveChannel.close();
    }
    pc.close();
    remotePeerConnection.close();
    pc = null;
    remotePeerConnection = null;
    localSdpTextarea.disabled = true;
    remoteSdpTextarea.disabled = true;
    getMediaButton.disabled = false;
    createPeerConnectionButton.disabled = true;
    createOfferButton.disabled = true;
    setOfferButton.disabled = true;
    createAnswerButton.disabled = true;
    setAnswerButton.disabled = true;
    hangupButton.disabled = true;
  }

  function gotRemoteStream(e) {
    if (remoteVideo.srcObject !== e.streams[0] && e.track.kind === "video") {
      let stream = e.streams[0];
      if (!stream)  {
        stream = new MediaStream();
        stream.addTrack(e.track);
      }
      remoteVideo.srcObject = stream;
      let streamId = stream.id;
      let trackId = e.track.id;
      console.log('Received remote stream ' + streamId + ' ' + trackId);
    }
  }

  async function onIceCandidate(pc, event) {
    console.log(`ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
    localSdpTextarea.value = pc.localDescription.sdp;
  }

  function onAddIceCandidateSuccess() {
    console.log('AddIceCandidate success.');
  }

  function onAddIceCandidateError(error) {
    console.log(`Failed to add Ice Candidate: ${error.toString()}`);
  }

  function receiveChannelCallback(event) {
    console.log('Receive Channel Callback');
    receiveChannel = event.channel;
    receiveChannel.onmessage = onReceiveMessageCallback;
    receiveChannel.onopen = onReceiveChannelStateChange;
    receiveChannel.onclose = onReceiveChannelStateChange;
  }

  function onReceiveMessageCallback(event) {
    dataChannelDataReceived = event.data;
    console.log(`DataChannel receive counter: ${dataChannelDataReceived}`);
  }

  function onSendChannelStateChange() {
    const readyState = sendChannel.readyState;
    console.log(`Send channel state is: ${readyState}`);
    if (readyState === 'open') {
      sendDataLoop = setInterval(sendData, 1000);
    } else {
      clearInterval(sendDataLoop);
    }
  }

  function onReceiveChannelStateChange() {
    const readyState = receiveChannel.readyState;
    console.log(`Receive channel state is: ${readyState}`);
  }
}
