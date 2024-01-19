import { Ai } from "@cloudflare/ai";
import { Hono } from "hono";

const NAME = "LavoroABTest";

import template from "./template.html";
import streamingTemplate from "./template-streaming.html";
import imageTemplate from "./image-template.html";


const app = new Hono();

app.get("/", (c) => c.html(streamingTemplate));
app.get("/b", (c) => c.html(template));
app.get("/c", (c) => c.html(imageTemplate));



// Function to save AI results to the database
async function saveResultToDatabase(database, query, result) {
  // Execute SQL to insert the query and result into the database
  await database.prepare(`
    INSERT INTO query_results (query, result) VALUES (?, ?);
  `).bind(query, result).run();
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

  // Use the database to save the AI response
  await saveResultToDatabase(database, question, answer);
  return c.text(answer);
});


// New route for AI image generation
app.get("/generate-image", async (c) => {
  const ai = new Ai(c.env.AI);

  // Retrieve the prompt from the query parameters
  const prompt = c.req.query("prompt") || 'cyberpunk cat';

  // Customize the prompt for image generation
  const inputs = {
    prompt,
  };

   try{
  // Run AI to generate an image
  const response = await ai.run(
    '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    inputs
  );

  // Return the image response
  return new Response(response, {
    headers: {
      'content-type': 'image/png',
    },
  });
} catch (error) {
  console.error('Error generating image:', error);
  return c.text('Error generating image');
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


