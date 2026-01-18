// Check for duplicate emoji names in PR submissions
//
// This script checks if an emoji PR is adding a file that already exists
// (by base name, ignoring extension). If a duplicate is found, it comments
// on the PR and closes it.

module.exports = async ({ github, context, changedFiles }) => {
  const pr = context.payload.pull_request;

  const isAddEmoji = pr.title.startsWith('Add emoji:');
  const isUpdateEmoji = pr.title.startsWith('Update emoji:');

  if (!isAddEmoji && !isUpdateEmoji) {
    console.log('Not an emoji submission PR, skipping.');
    return;
  }

  const labels = pr.labels.map(l => l.name);
  if (labels.includes('Update')) {
    console.log('PR has "Update" label, skipping duplicate check.');
    return;
  }

  const prFiles = parseChangedFiles(changedFiles);
  const imageFiles = filterImageFiles(prFiles);

  if (imageFiles.length === 0) {
    console.log('No image files found in PR.');
    return;
  }

  const newEmojiNames = getBaseNames(imageFiles);
  console.log(`New emoji names: ${newEmojiNames.join(', ')}`);

  const duplicates = await findDuplicates(github, context, pr.base.sha, newEmojiNames);

  if (duplicates.length > 0) {
    await handleDuplicates(github, context, pr.number, duplicates);
  } else {
    console.log('No duplicates found.');
  }
};

function parseChangedFiles(changedFilesStr) {
  if (!changedFilesStr) {
    return [];
  }

  const files = changedFilesStr.split(',').filter(f => f.trim() !== '');
  console.log(`Files in PR: ${files.length}`);
  files.forEach(f => console.log(`  - ${f}`));

  return files.map(filename => ({ filename: filename.trim() }));
}

function filterImageFiles(files) {
  const imageExtensions = ['.png', '.gif', '.webp', '.jpg', '.jpeg'];

  return files.filter(f => {
    const lowerName = f.filename.toLowerCase();
    return imageExtensions.some(ext => lowerName.endsWith(ext));
  });
}

function getBaseNames(files) {
  return files.map(f => {
    const fileName = f.filename.split('/').pop();
    return fileName.replace(/\.[^.]+$/, '').toLowerCase();
  });
}

async function findDuplicates(github, context, baseSha, newEmojiNames) {
  const { data: tree } = await github.rest.git.getTree({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tree_sha: baseSha,
    recursive: 'true'
  });

  return tree.tree.filter(item => {
    if (item.type !== 'blob') return false;
    const fileName = item.path.split('/').pop();
    const baseName = fileName.replace(/\.[^.]+$/, '').toLowerCase();
    return newEmojiNames.includes(baseName);
  });
}

async function handleDuplicates(github, context, prNumber, duplicates) {
  const duplicatePaths = duplicates.map(d => `\`${d.path}\``).join('\n- ');
  const duplicateNames = [...new Set(duplicates.map(d => {
    const fileName = d.path.split('/').pop();
    return fileName.replace(/\.[^.]+$/, '');
  }))].join(', ');

  const commentBody = `## Duplicate Emoji Detected

An emoji with a matching name already exists in the repository:

- ${duplicatePaths}

Please choose a different name for your emoji and edit it back on the submission site, or close this PR and submit again.

If you intended to update an existing emoji, please resubmit with the "Update Existing Emoji" checkbox checked.

---
*This check was performed automatically.*`;

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body: commentBody
  });

  console.log(`PR #${prNumber} has duplicate emoji: ${duplicateNames}`);

  throw new Error(`Duplicate emoji detected: ${duplicateNames}`);
}
