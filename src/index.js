import { Ai } from "@cloudflare/ai";
import { Hono } from "hono";

import template from "./template.html";
import streamingTemplate from "./template-streaming.html";
import imageTemplate from "./image-template.html";
import imgGen from "./img-class.html";
import imgClass from "./class-template.html";

const app = new Hono();

app.get("/", (c) => c.html(streamingTemplate));
app.get("/b", (c) => c.html(template));
app.get("/c", (c) => c.html(imageTemplate));
app.get("/d", (c) => c.html(imgGen));
app.get("/e", (c) => c.html(imgClass));


// Function to save AI results to the database
async function saveResultToDatabase(database, query, result) {
  // Execute SQL to insert the query and result into the database
  await database.prepare(`
    INSERT INTO query_results (query, result) VALUES (?, ?);
  `).bind(query, result).run();
}

async function performSentimentAnalysis(text, ai) {
  const sentimentInputs = {
    text,
  };

  const sentimentResponse = await ai.run(
    '@cf/huggingface/distilbert-sst-2-int8',
    sentimentInputs
  );

  return sentimentResponse[1]; // Assuming the model returns a single sentiment result
}

function formatSentiment(sentimentResult) {
  if (!sentimentResult || !sentimentResult.label || !sentimentResult.score) {
    return "Sentiment: N/A";
  }

  const sentimentText = `Sentiment: ${sentimentResult.label}, Score: ${sentimentResult.score}`;
  return sentimentText;
}


app.get("/stream", async (c) => {
  const ai = new Ai(c.env.AI);
  const query = c.req.query("query");
  const question = query || "What is the square root of 9?";
  const systemPrompt = c.req.query("systemPrompt") || "police officer";

  const stream = await ai.run(
    "@cf/meta/llama-2-7b-chat-int8",
    {
      messages: [
        { role: "system", content: `You are a ${systemPrompt}.` },
        { role: "user", content: question },
      ],
      stream: true,
    },
  );
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
    },
  });
});



app.post("/", async (c) => {
  const ai = new Ai(c.env.AI);
  const database = c.env.DB;

  const body = await c.req.json();
  const question = body.query || "What is the square root of 9?";


  const systemPrompt = `You are a helpful assistant.`;

  const { response: answer } = await ai.run(
    "@cf/meta/llama-2-7b-chat-int8",
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    },
  );

   // Perform sentiment analysis on the user's input
   const sentimentResult = await performSentimentAnalysis(question, ai);

   // Format sentiment result as text
  const sentimentText = formatSentiment(sentimentResult);

  // Use the database to save the AI response
  await saveResultToDatabase(database, question, answer + sentimentText);
  return c.text(answer);
});


// Common function for image generation
async function generateImage(ai, prompt) {
  const inputs = {
    prompt,
  };

  try {
    const response = await ai.run(
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      inputs
    );

    return new Response(response, {
      headers: {
        'content-type': 'image/png',
      },
    });
  } catch (error) {
    console.error('Error generating image:', error);
    return new Response(JSON.stringify({ error: 'Error generating image' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

// Route for image generation only
app.get("/generate-image", async (c) => {
  const ai = new Ai(c.env.AI);
  const prompt = c.req.query("prompt") || 'cyberpunk cat';

  return await generateImage(ai, prompt);
});

// Function to process image using Cloudflare AI
async function processImage(ai, imageBuffer) {
  const inputs = {
    image: [...new Uint8Array(imageBuffer)],
  };

  const response = await ai.run('@cf/microsoft/resnet-50', inputs);
  return response;
}

// Route for processing uploaded images
app.post("/upload-and-classify", async (c) => {
  const ai = new Ai(c.env.AI);

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image");

    if (!imageFile) {
      return c.json({ error: "No image uploaded" });
    }

    const imageBuffer = await imageFile.arrayBuffer();
    const imageProcessingResult = await processImage(ai, imageBuffer);

    return c.json({ imageProcessingResult });
  } catch (error) {
    console.error('Error processing uploaded image:', error);
    return c.json({ error: 'Error processing uploaded image' });
  }
});

// Cloudflare Worker functionality for PUT operation
app.put("/upload-image", async (c) => {
  const env = c.env; // Assuming env contains MY_BUCKET

  // Extract prompt from the request body
  const body = await c.req.json();
  const prompt = body.prompt;

  // Generate a unique key based on the prompt (you may need to customize this)
  const key = prompt.replace(/\s+/g, '_').toLowerCase();

  // Get the image data from the AI based on the prompt
  const ai = new Ai(env.AI);
  const inputs = { prompt };

  try {
    const response = await ai.run('@cf/stabilityai/stable-diffusion-xl-base-1.0', inputs);

    // Upload the image data to the bucket
    await env.MY_BUCKET.put(key, response);

    // Return a success response
    return c.text(`Image uploaded successfully with key: ${key}`);
  } catch (error) {
    console.error('Error generating or uploading image:', error);
    return c.text('Error generating or uploading image');
  }
});



// Function to retrieve the last query and its result from the database
async function displayResultFromDatabase(database) {
  try {
  // Execute SQL to retrieve the last query and result from the database
  const {results} = await database.prepare(`
    SELECT query, result
    FROM query_results
    ORDER BY id DESC
    LIMIT 1;
  `).all();

  console.log('Query result:', results);

  if (results.length > 0) {
    return { query: results[0].query, answer: results[0].result };
  } else {
    return null; // Return null for cases where there are no results
  }
} catch (error) {
  console.error('Error retrieving result from the database:', error);
  throw error;
}
}


app.get('/last-query', async (c) => {
  const database = c.env.DB;

  try {
    // Retrieve the last query and its result from the database
    const result = await displayResultFromDatabase(database);

    if (result) {
      // If there is a result, return it as JSON
      return c.json(result);
    } else {
      // If there is no result, return an appropriate response
      return c.json({error:"No previous queries."});
    }
  } catch (error) {
    console.error("An error occurred while fetching the last query:", error);
    return c.json({error:"Error fetching the last query."});
  }
});

app.onError((err, c) => {
  return c.text(err);
});


export default app;


