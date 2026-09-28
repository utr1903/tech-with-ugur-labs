FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Qwen Code, pinned through the lockfile.
WORKDIR /opt/qwen-code
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
ENV PATH=/opt/qwen-code/node_modules/.bin:$PATH

COPY run-agent.sh interactive.sh containment-check.sh check-hook.sh /usr/local/bin/
RUN install -d -o node -g node /opt/qwen-seed /opt/superpowers /workspace

USER node
# Superpowers from the pinned tag. Installing from a local clone records
# what was installed; installing with --ref would download a tarball with
# no commit to check.
ENV QWEN_HOME=/opt/qwen-seed
RUN git clone --quiet --depth 1 --branch v6.4.2 https://github.com/obra/superpowers.git /opt/superpowers \
 && qwen extensions install /opt/superpowers:superpowers --consent
COPY --chown=node:node settings.json /opt/qwen-seed/settings.json

# Qwen substitutes ${CLAUDE_PLUGIN_ROOT} into the hook command but does not
# export it. Exported, the Superpowers session-start hook prints the format
# Qwen reads, so the using-superpowers bootstrap reaches the model.
ENV QWEN_HOME=/run/qwen/home \
    QWEN_RUNTIME_DIR=/run/qwen/runtime \
    CLAUDE_PLUGIN_ROOT=/run/qwen/home/extensions/superpowers \
    npm_config_cache=/tmp/npm-cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN QWEN_HOME=/opt/qwen-seed CLAUDE_PLUGIN_ROOT=/opt/qwen-seed/extensions/superpowers check-hook.sh

WORKDIR /workspace
ENTRYPOINT ["run-agent.sh"]
