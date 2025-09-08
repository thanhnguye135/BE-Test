import fs from "fs";
import csv from "csv-parser";
import ExcelJS from "exceljs";

async function csvToExcel(csvFilePath, csvFilePath1, excelFilePath) {
  const data = [];
  const data1 = [];

  // Read first CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on("data", (row) => data.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  // Read second CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath1)
      .pipe(csv())
      .on("data", (row) => data1.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  // Collect conversationChatBotIds from first file
  const conversationChatBotIds = data.map((item) =>
    String(item.conversationChatBotId).trim()
  );

  console.log(conversationChatBotIds.length, "conversationChatBotIds found");

  // Keep only rows in second file that match conversationChatBotIds
  const questionMapping = data1
    .filter((item) =>
      conversationChatBotIds.includes(String(item.conversationId).trim())
    )
    .filter((item) => item.sendFrom === "USER")
    .map((item) => {
      const now = new Date(item.createdAt);
      const withoutMs = now.toISOString().split(".")[0].replace("T", " ");

      return {
        content: item.content,
        userId: item.userId,
        createdAt: withoutMs,
      };
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  console.log("Matched rows:", questionMapping.length);

  // Create Excel workbook and sheet (short name ≤ 31 chars)
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("UserQuestionMapping");

  console.log(questionMapping);
  console.log(Object.keys(questionMapping[0] || {}));

  if (questionMapping.length > 0) {
    worksheet.columns = Object.keys(questionMapping[0]).map((key) => ({
      header: key,
      key,
      width: 20,
    }));

    questionMapping.forEach((row) => worksheet.addRow(row));
  }

  await workbook.xlsx.writeFile(excelFilePath);
}

const csvFilePath = "_ChatGlobal__202508281131.csv";
const csvFilePath1 = "_MessageLLM__202508281131.csv";
const excelFilePath = "output.xlsx";

csvToExcel(csvFilePath, csvFilePath1, excelFilePath)
  .then(() => console.log("✅ CSV converted to Excel successfully"))
  .catch((error) => console.error("❌ Error converting CSV to Excel:", error));
