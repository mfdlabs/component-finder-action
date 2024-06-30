import * as core from '@actions/core'

import fs from 'fs'
import path from 'path'
import yaml from 'yaml'

const validComponentRegex = /^[a-zA-Z0-9_\-.]+(:[a-zA-Z0-9_\-.]+)?$/
const defaultComponentFileNameRegex = /^\.component\.ya?ml$/

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const components = core
      .getInput('components', { required: true })
      ?.split(',')
      .map(component => component.trim())
    const componentSearchDirectories = core
      .getInput('component-search-directories', { required: false })
      ?.split(',')
      .map(directory => directory.trim())

    // Clean out any empty strings
    if (components) {
      components.filter(Boolean)
    }

    if (componentSearchDirectories) {
      componentSearchDirectories.filter(Boolean)
    }

    if (!components || components.length === 0) {
      core.setFailed('No components provided to search for.')

      return
    }

    // Make sure component search directories are resolved to the absolute path of the repository
    const repositoryPath = process.env.GITHUB_WORKSPACE

    if (repositoryPath === undefined) {
      core.setFailed('No repository path found.')

      return
    }

    if (componentSearchDirectories.length > 0) {
      for (let i = 0; i < componentSearchDirectories.length; i++) {
        const searchDir = componentSearchDirectories[i]

        if (!path.isAbsolute(searchDir)) {
          componentSearchDirectories[i] = path.resolve(
            repositoryPath,
            searchDir
          )
        }
      }
    }

    const prettyDirectories =
      componentSearchDirectories.length === 0
        ? 'all directories'
        : componentSearchDirectories.join(', ')

    core.info(
      `Finding components: ${components.join(', ')} in directories: ${prettyDirectories}`
    )

    // Step 1: Validate the components
    const newComponents: string[] = []

    for (const component of components) {
      if (!validComponentRegex.test(component)) {
        core.error(`Invalid component name: ${component}`)

        continue
      }

      if (component.split(':').length > 1) {
        const [name, version] = component.split(':')
        console.log(`Component: ${name}, Version: ${version}`)

        newComponents.push(`${name}:${version}`)
      } else {
        console.log(`Component: ${component}, Version: latest`)

        newComponents.push(`${component}:latest`)
      }
    }

    if (newComponents.length === 0) {
      core.setFailed('No valid components provided to search for.')

      return
    }

    // Step 2: Find the components

    const foundComponents = []
    const componentMap: { [key: string]: string } = {}

    // Recursively search for the component configuration file
    const searchForComponent = (dir: string): void => {
      if (!fs.existsSync(dir)) {
        core.warning(`Directory ${dir} does not exist`)

        return
      }

      const files = fs.readdirSync(dir)

      for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        console.log(`Checking file: ${filePath}`)

        if (stat.isDirectory()) {
          searchForComponent(filePath)
        } else if (defaultComponentFileNameRegex.test(file)) {
          const componentConfig = fs.readFileSync(filePath, 'utf8')
          const component = yaml.parse(componentConfig).component

          for (const neededComponent of newComponents) {
            if (neededComponent.split(':')[0] === component) {
              componentMap[neededComponent] = path.resolve(filePath)

              foundComponents.push(component)
            }
          }
        }
      }
    }

    if (componentSearchDirectories.length === 0) {
      componentSearchDirectories.push(process.cwd())
    }

    for (const searchDir of componentSearchDirectories) {
      searchForComponent(searchDir)
    }

    // Make a warning for each component that was not found
    for (const component of newComponents.map(c => c.split(':')[0])) {
      if (!newComponents.includes(component)) {
        core.warning(`Component ${component} not found`)
      }
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
