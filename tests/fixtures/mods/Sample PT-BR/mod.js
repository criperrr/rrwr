module.exports = {
  title: "Sample PT-BR",
  summary: "Uma historia de exemplo sobre um jovem explorador, seus amigos e uma jornada interativa. Agora disponivel em portugues-brasileiro!",
  author: "Sample BR Team",
  modVersion: 2.0,

  edit: true,

  trees: {
    "./Assets/": "assets://"
  },

  vueHooks: [{
    matchName: "pageText",
    computed: {
      logButtonText() {
        let text = this.content.match(/\|(.*?)\|/)[1]
        const state = (this.logHidden) ? 'Abrir ' : 'Fechar '
        if (/PASSCODE HINT/i.test(text)) {
          return text
        }
        else if (/altlog/i.test(text)) {
          text = 'altlog'
        }
        else if (/specialnote/i.test(text)) {
          text = 'special note'
        }
        return state + text.toLowerCase()
      },
    },
  }],

  computed(api) {
    const translation = api.readJson('./translation2.json')
    api.logger.info(translation)

    return {
      edit(archive) {
        for (const page_num in translation) {
          archive.storyData.story[page_num] = {
            ...archive.storyData.story[page_num],
            ...translation[page_num]
          }
          console.log(archive.storyData.story[page_num])
        }
      }
    }
  }
}
