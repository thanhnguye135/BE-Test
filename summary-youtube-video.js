import OpenAI from "openai";
import fs from "fs";
import AWS from "aws-sdk";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@deepgram/sdk";
import ytdl from "@distube/ytdl-core";
import ffmpeg from "fluent-ffmpeg";

dotenv.config();

function decodeXml(xml) {
  return xml
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

async function fetchYoutubeTranscript(videoId, language = "en") {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const html = await fetch(videoUrl).then((res) => res.text());
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!apiKeyMatch) throw new Error("INNERTUBE_API_KEY not found.");
  const apiKey = apiKeyMatch[1];

  const playerData = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240401.01.00",
          },
        },
        videoId,
      }),
    }
  ).then((res) => res.json());

  //   console.log(playerData);

  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks) {
    console.log("No captions found.");
    return [];
  }

  const track = tracks.find((t) => t.languageCode === language);
  if (!track) {
    console.log(`No captions for language: ${language}`);
    return [];
  }

  const baseUrl = track.baseUrl.replace(/&fmt=\w+$/, "");

  const xml = await fetch(baseUrl).then((res) => res.text());

  const transcript = [];
  const regex = /<text start="([^"]+)" dur="([^"]+)">(.+?)<\/text>/g;
  const matches = xml.matchAll(regex);

  for (const match of matches) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const caption = decodeXml(match[3]);

    transcript.push({
      caption,
      startTime: start,
      endTime: start + duration,
    });
  }

  return transcript;
}

async function main() {
  const videoId = process.argv[2];

  console.log("Fetching transcript for video ID:", videoId);
  const rawTransctipt = await fetchYoutubeTranscript(videoId, "en");
  const transcripts = rawTransctipt.reduce((acc, transcript) => {
    return (
      acc +
      `[${transcript.startTime.toFixed(2)} - ${transcript.endTime.toFixed(
        2
      )}] ${transcript.caption}\n`
    );
  }, "");

  console.log("Transcript: \n", transcripts + "\n");

  const s3 = new AWS.S3({
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_KEY,
    },
    region: process.env.AWS_REGION,
    apiVersion: "2006-03-01",
    signatureVersion: "v4",
    s3ForcePathStyle: true,
  });

  if (transcripts) {
    fs.writeFileSync("transcript.txt", transcripts);
    console.log("Transcript saved to transcript.txt");

    const fileContent = fs.readFileSync("transcript.txt");

    const params = {
      Bucket: process.env.S3_BUCKET,
      Key: path.basename("transcript.txt"),
      Body: fileContent,
      ContentType: "text/plain; charset=utf-8",
    };

    const resultUpload = await s3.upload(params).promise();
    console.log("File uploaded successfully at", resultUpload.Location);

    const aiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE_URL,
    });

    const fileUrl = `${process.env.AWS_CDN}/${path.basename("transcript.txt")}`;

    const result = await aiClient.chat.completions.create({
      model: "default",
      tools: [
        {
          type: "transcript_report",
        },
      ],
      stream: false,
      messages: [],
      metadata: {
        transcript_path: fileUrl,
        timezone: "GMT+00",
      },
    });

    const summary = result?.choices[0]?.message?.content;

    console.log("Summary: \n", summary);
  } else {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const output = "audio.webm";
    const convertedOutput = "output.wav";

    const stream = await ytdl(url, { filter: "audioonly" }).pipe(
      fs.createWriteStream(output)
    );

    stream.on("finish", async () => {
      ffmpeg(output)
        .toFormat("wav")
        .on("end", () => {
          console.log("file has been converted succesfully");
        })
        .on("error", (err) => {
          console.log("an error happened: " + err.message);
        })
        .save(convertedOutput);

      const fileContent = fs.readFileSync(convertedOutput);

      const params = {
        Bucket: process.env.S3_BUCKET,
        Key: path.basename(convertedOutput),
        Body: fileContent,
        ContentType: "audio/wav",
      };

      const resultUpload = await s3.upload(params).promise();
      console.log("File uploaded successfully at", resultUpload.Location);

      const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

      const { result, error } = await deepgram.listen.prerecorded.transcribeUrl(
        {
          url: `${process.env.AWS_CDN}/${path.basename(convertedOutput)}`,
        },
        {
          model: "nova-2",
          smart_format: true,
          summarize: true,
          diarize: true,
        }
      );

      if (error) {
        console.error("Deepgram error:", error);
        return;
      }

      fs.writeFileSync("summary.json", JSON.stringify(result, null, 2));
      console.log("Transcription and summary saved to summary.json");
    });
  }
}

main();
