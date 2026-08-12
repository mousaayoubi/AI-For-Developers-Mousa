/**
 * The one tool exposed to the model. Real project facts live here so the
 * model can look them up instead of guessing.
 */
const project = {
  stack: 'Node.js, Express, PostgreSQL',
  testing: 'Vitest and Supertest',
  architecture: 'Controller, Service, Repository',
};

export function getProjectInfo(section) {
  const key = String(section || '').toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(project, key)) {
    return project[key];
  }
  return `Unknown project info section "${section}". Available sections: ${Object.keys(project).join(', ')}.`;
}

/** Tool definition in the schema Ollama's /api/chat expects. */
export const projectInfoToolDefinition = {
  type: 'function',
  function: {
    name: 'get_project_info',
    description:
      'Get real, authoritative information about this project (stack, testing setup, or architecture) ' +
      'instead of guessing or inventing it.',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: Object.keys(project),
          description: 'Which section of project info to retrieve.',
        },
      },
      required: ['section'],
    },
  },
};
