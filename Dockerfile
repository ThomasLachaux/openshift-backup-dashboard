FROM node:lts-alpine

ENV NODE_ENV=production
ENV OC_VERSION "v3.11.0"
ENV OC_RELEASE "openshift-origin-client-tools-v3.11.0-0cbc58b-linux-64bit"

EXPOSE 8080

WORKDIR /opt

COPY package.json yarn.lock ./
RUN yarn

COPY . .

ADD https://github.com/openshift/origin/releases/download/$OC_VERSION/$OC_RELEASE.tar.gz /tmp/oc/release.tar.gz
RUN tar --strip-components=1 -xzvf  /tmp/oc/release.tar.gz -C /tmp/oc/ && \
  mv /tmp/oc/oc /usr/bin/ && \
  rm -rf /tmp/oc

# Give only access to root without recursion because node_modules too long
RUN chmod g=u .

CMD yarn start