# Contributing to FrostSentinel Plugin System

Thank you for your interest in contributing! 🎉

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Plugin Contributions](#plugin-contributions)
- [Code Contributions](#code-contributions)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)

## 🤝 Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help newcomers learn
- Focus on what's best for the community

## 🎯 How to Contribute

There are many ways to contribute:

1. **Create Plugins** - Share your amazing plugin creations
2. **Report Bugs** - Help us identify and fix issues
3. **Suggest Features** - Share ideas for improvements
4. **Improve Documentation** - Help others understand the system
5. **Submit Code** - Contribute bug fixes or features

## 🎨 Plugin Contributions

### Creating a Plugin

1. **Develop your plugin** using the DSL
2. **Test thoroughly** in your Discord server
3. **Document** what it does and how to use it
4. **Share** via pull request or the marketplace

### Plugin Checklist

- [ ] Follows DSL syntax correctly
- [ ] Declares all required scopes
- [ ] Has clear documentation
- [ ] Includes usage examples
- [ ] Handles errors gracefully
- [ ] Respects user privacy
- [ ] No hardcoded sensitive data

### Plugin Best Practices

```javascript
// ✅ GOOD: Clear, documented, secure
module plugin {
    manifest {
        name "MyPlugin"
        version "1.0.0"
        author "YourName"
        description "Clear description of what this does"
        scopes ["messages.send"]  // Only request needed permissions
    }
    
    command hello {
        description "Says hello to the user"
        on_command {
            guilds.send(message.channel_id, "Hello!")
        }
    }
}

// ❌ BAD: No manifest, unclear purpose
command hello {
    on_command {
        // No error handling, no documentation
        guilds.send(message.channel_id, "Hi")
    }
}
```

## 💻 Code Contributions

### What We Accept

✅ **Always Welcome:**
- Bug fixes
- Documentation improvements
- Test additions
- Performance optimizations
- New DSL features (with discussion)

⚠️ **Needs Approval:**
- Changes to PluginManager core logic
- Security-related modifications
- Breaking changes
- New dependencies

### What to Avoid

❌ **Generally Not Accepted:**
- Changes that break existing plugins
- Removing security features
- Code that bypasses sandboxing
- Unnecessary dependencies

## 🛠️ Development Setup

1. **Fork and clone:**
```bash
git clone https://github.com/YourUsername/FrostSentinel.git
cd FrostSentinel
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create a test bot:**
```typescript
// test-bot.ts
import { Client } from 'discord.js';
import { PluginManager } from './PluginManager';

const client = new Client({ /* intents */ });
const pluginManager = new PluginManager(client);

client.login('YOUR_TEST_TOKEN');
```

4. **Test your changes:**
- Create test plugins
- Run in a test Discord server
- Verify no breaking changes

## 📝 Pull Request Process

### Before Submitting

1. **Test everything:**
   - All existing plugins still work
   - New features work as expected
   - No console errors
   - Performance is acceptable

2. **Update documentation:**
   - Add/update README sections
   - Include JSDoc comments
   - Update examples if needed

3. **Follow code style:**
   - Use existing patterns
   - Add comments for complex logic
   - Keep functions focused and small

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Breaking change

## Testing
How have you tested this?

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-reviewed the code
- [ ] Commented complex sections
- [ ] Updated documentation
- [ ] No breaking changes (or documented if necessary)
- [ ] Added tests (if applicable)
```

### Review Process

1. **FrostByteNinja** will review all PRs
2. Changes may be requested
3. Once approved, PR will be merged
4. Contributors will be credited

## 📏 Coding Standards

### TypeScript Style

```typescript
// ✅ GOOD: Clear naming, typed, documented
/**
 * Parses command parameters from DSL code
 * @param block - The DSL code block containing parameters
 * @returns Map of parameter names to definitions
 */
private parseParameters(block: string): Map<string, ParameterDef> {
    const params = new Map<string, ParameterDef>();
    // ... implementation
    return params;
}

// ❌ BAD: Unclear naming, no types, no docs
function parse(b: any): any {
    let p = new Map();
    // ... implementation
    return p;
}
```

### Comments

- **Use comments** to explain "why", not "what"
- **Add JSDoc** for public methods
- **Explain complex** algorithms or regex
- **Keep comments** up-to-date with code

```typescript
// ✅ GOOD: Explains the reasoning
// We use VM2 instead of native eval() because it provides
// a secure sandbox that prevents plugins from accessing
// sensitive Node.js APIs or the filesystem
const vm = new VM({ timeout: 5000 });

// ❌ BAD: States the obvious
// Create a new VM
const vm = new VM({ timeout: 5000 });
```

### Error Handling

```typescript
// ✅ GOOD: Specific, helpful errors
try {
    const manifest = this.parseManifest(code);
} catch (error) {
    console.error('[PluginManager] Failed to parse manifest:', error);
    throw new Error(`Invalid plugin manifest: ${error.message}`);
}

// ❌ BAD: Silent failures or generic errors
try {
    this.parseManifest(code);
} catch (error) {
    // Silently fail or throw generic error
}
```

### Security First

```typescript
// ✅ GOOD: Validates and sanitizes
if (!url.startsWith('http')) {
    throw new Error('Invalid URL - must start with http/https');
}

// ❌ BAD: Trusts user input
axios.get(url);  // User could provide file:// or other protocols
```

## 🏷️ Commit Messages

Use clear, descriptive commit messages:

```bash
# ✅ GOOD
git commit -m "Add support for multi-param commands"
git commit -m "Fix: Handle null channel in logic listeners"
git commit -m "Docs: Update DSL syntax examples"

# ❌ BAD
git commit -m "fix stuff"
git commit -m "update"
git commit -m "changes"
```

### Commit Prefixes

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `style:` - Code style/formatting
- `refactor:` - Code restructuring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## 🐛 Reporting Bugs

### Before Reporting

1. Check existing issues
2. Try the latest version
3. Verify it's not a plugin issue

### Bug Report Template

```markdown
**Describe the bug**
Clear description of what's wrong

**To Reproduce**
1. Install plugin...
2. Run command...
3. See error...

**Expected behavior**
What should happen

**Screenshots/Logs**
Console output or screenshots

**Environment**
- Node version:
- Discord.js version:
- OS:
```

## 💡 Feature Requests

### Good Feature Requests

```markdown
**Feature:** Add support for slash commands

**Use Case:** Many users prefer slash commands over prefix commands

**Proposed Solution:** Add a new command type...

**Alternatives:** Could use...

**Additional Context:** Example code...
```

## 🎓 Learning Resources

- [DSL Syntax Guide](./docs/DSL_GUIDE.md)
- [Plugin Examples](./examples/)
- [Discord.js Docs](https://discord.js.org)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## 📧 Contact

- **Issues:** [GitHub Issues](https://github.com/YourUsername/FrostSentinel/issues)
- **Discussions:** [GitHub Discussions](https://github.com/YourUsername/FrostSentinel/discussions)
- **Discord:** [Join our server](https://discord.gg/your-invite)

## 🙏 Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Credited in release notes
- Mentioned in documentation (for significant contributions)

---

**Thank you for contributing to FrostSentinel! 🚀**

*By contributing, you agree that your contributions will be licensed under the MIT License.*
