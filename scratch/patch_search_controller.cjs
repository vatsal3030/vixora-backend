const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/controllers/search.controller.js');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Wrap findVideos body
const findVideosSignature = `const findVideos = async ({
  q,
  tags,
  category,
  skip = 0,
  take = 10,
  sortBy,
  sortType,
  videoType = "all",
}) => {`;

const findVideosReplacement = `const findVideos = async ({
  q,
  tags,
  category,
  skip = 0,
  take = 10,
  sortBy,
  sortType,
  videoType = "all",
}) => {
  try {`;

code = code.replace(findVideosSignature, findVideosReplacement);
code = code.replace(`  return { items, totalItems };
};

const findChannels`, `  return { items, totalItems };
  } catch (error) {
    console.error("findVideos search error:", error?.message || error);
    return { items: [], totalItems: 0 };
  }
};

const findChannels`);

// 2. Wrap findChannels body
code = code.replace(`const findChannels = async ({ q, category, skip = 0, take = 10, sortBy, sortType }) => {`,
`const findChannels = async ({ q, category, skip = 0, take = 10, sortBy, sortType }) => {
  try {`);

code = code.replace(`  return { items, totalItems };
};

const findTweets`, `  return { items, totalItems };
  } catch (error) {
    console.error("findChannels search error:", error?.message || error);
    return { items: [], totalItems: 0 };
  }
};

const findTweets`);

// 3. Wrap findTweets body
code = code.replace(`const findTweets = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {`,
`const findTweets = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  try {`);

code = code.replace(`  return { items, totalItems };
};

const findPlaylists`, `  return { items, totalItems };
  } catch (error) {
    console.error("findTweets search error:", error?.message || error);
    return { items: [], totalItems: 0 };
  }
};

const findPlaylists`);

// 4. Wrap findPlaylists body
code = code.replace(`const findPlaylists = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {`,
`const findPlaylists = async ({ q, skip = 0, take = 10, sortBy, sortType }) => {
  try {`);

code = code.replace(`  return { items, totalItems };
};

const saveSearchHistory`, `  return { items, totalItems };
  } catch (error) {
    console.error("findPlaylists search error:", error?.message || error);
    return { items: [], totalItems: 0 };
  }
};

const saveSearchHistory`);

fs.writeFileSync(filePath, code, 'utf8');
console.log("Successfully patched search.controller.js with resilience try/catch blocks");
