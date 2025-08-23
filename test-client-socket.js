import {io}  from 'socket.io-client';
import fs from 'fs';

const socket = io('http://localhost:3000', {
    transports: ['websocket']
});

socket.on('connect', () => {
    console.log('Connected to server', socket.id);

    const audioBuffer = fs.readFileSync('test-audio-fixed.wav');

    const chunkSize = 3200;
    for(let i = 0; i <audioBuffer.length; i += chunkSize) {
        const chunk = audioBuffer.slice(i, i + chunkSize);
        socket.emit('audio-chunk', chunk);
        console.log(`Sent chunk of size: ${chunk.length}`);
    }




    socket.on('transcript', (data) => {
        console.log('Received transcript:', data);
    });
});

socket.on('disconnect', () => {
    console.log('Disconnected from server', socket.id);
});
