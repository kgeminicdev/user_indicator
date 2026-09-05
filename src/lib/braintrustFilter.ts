// Skills that indicate an actual software developer, pulled from the most
// common skills among title='Engineering' freelancers (see conversation
// history for the frequency analysis). Deliberately excludes generic terms
// like "Web", "Security", or "Infrastructure" that non-developers (sysadmins,
// mechanical engineers, etc.) also list.
export const DEVELOPER_SKILLS = [
  "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "PHP", "Ruby", "Go", "Swift", "Kotlin",
  "React", "React Native", "Angular", "Vue", "Next.js", "Node.js", "Django", "Flask", "Spring",
  "Redux", "GraphQL", "Rest API", "Ruby on Rails", "Express.js.", "Laravel",
  "MySQL", "Postgres", "MongoDB", "MS SQL", "Oracle", "DynamoDB", "SQL", "NoSQL",
  "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Terraform", "Jenkins",
  "iOS", "Android", "Solidity", "Web3.js", "Ethereum", "Blockchain", "Smart Contracts",
  "Machine Learning", "Artificial Intelligence", "WordPress",
  "Full Stack Engineering", "Front End Engineering", "Backend Engineering", "Mobile Engineering",
  "Cloud Engineering", "DevOps", "Software Development", "Full Stack Software Developer",
];

function sqlStringArray(values: string[]): string {
  return `ARRAY[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")}]`;
}

// Shared candidate filter: Engineering title, has an external profile link,
// and lists at least one recognizable developer skill.
export const BRAINTRUST_FILTER = `
  title = 'Engineering'
  AND jsonb_array_length(coalesce(data->'external_profiles', '[]'::jsonb)) > 0
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(data->'freelancer_skills', '[]'::jsonb)) s
    WHERE s->'skill'->>'name' = ANY(${sqlStringArray(DEVELOPER_SKILLS)})
  )
`;
