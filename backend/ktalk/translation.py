"""Offline OPUS-MT -> Brazilian Portuguese, converted directly from Marian weights."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import unicodedata
import zipfile

MODEL_GROUP = 'en-fr+fr_BE+fr_CA+fr_FR+wa+frp+oc+ca+rm+lld+fur+lij+lmo+es+es_AR+es_CL+es_CO+es_CR+es_DO+es_EC+es_ES+es_GT+es_HN+es_MX+es_NI+es_PA+es_PE+es_PR+es_SV+es_UY+es_VE+pt+pt_br+pt_BR+pt_PT+gl+lad+an+mwl+it+it_IT+co+nap+scn+vec+sc+ro+la'
MODEL_URL = f'https://object.pouta.csc.fi/OPUS-MT-models/{MODEL_GROUP}/opus-2020-04-21.zip'


def prepare_translation(cache: Path, progress=lambda message: None, cancelled=lambda: False) -> Path:
    import httpx
    import yaml
    from ctranslate2.converters import OpusMTConverter

    target = cache / 'opus-en-pt-br-int8'
    required = ('model.bin', 'config.json', 'source.spm', 'target.spm', 'ktalk.json')
    if all((target / filename).is_file() for filename in required):
        return target
    staging = cache / 'translation-download'
    staging.mkdir(parents=True, exist_ok=True)
    archive = staging / 'opus-2020-04-21.zip'
    if not archive.exists():
        progress('Baixando o tradutor local de inglês para PT-BR…')
        temporary = staging / 'download.part'
        with httpx.stream('GET', MODEL_URL, follow_redirects=True, timeout=90) as response:
            response.raise_for_status()
            size = int(response.headers.get('content-length', 0))
            downloaded = 0
            last_update = -1
            with temporary.open('wb') as output:
                for block in response.iter_bytes(1024 * 1024):
                    if cancelled():
                        raise InterruptedError('Preparação cancelada.')
                    output.write(block)
                    downloaded += len(block)
                    if downloaded > 1024 ** 3:
                        raise RuntimeError('O pacote de tradução excede o tamanho esperado.')
                    megabytes = downloaded // (1024 * 1024)
                    if megabytes // 10 != last_update:
                        total = f' / {size // (1024 * 1024)} MB' if size else ' MB'
                        progress(f'Baixando tradução PT-BR: {megabytes}{total}')
                        last_update = megabytes // 10
            if size and downloaded != size:
                raise RuntimeError('Download incompleto do tradutor. Tente novamente.')
        temporary.replace(archive)
    if cancelled():
        raise InterruptedError('Preparação cancelada.')
    raw = staging / 'source'
    raw.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        if sum(entry.file_size for entry in package.infolist()) > 3 * 1024 ** 3:
            raise RuntimeError('Pacote de tradução inválido.')
        for entry in package.infolist():
            destination = (raw / entry.filename).resolve()
            if not destination.is_relative_to(raw.resolve()):
                raise RuntimeError('Caminho inválido no pacote de tradução.')
            if not entry.is_dir():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with package.open(entry) as source, destination.open('wb') as output:
                    shutil.copyfileobj(source, output)
    with (raw / 'decoder.yml').open(encoding='utf-8') as handle:
        decoder = yaml.safe_load(handle)
    for reference in decoder['models'] + decoder['vocabs']:
        if not (raw / reference).resolve().is_relative_to(raw.resolve()):
            raise RuntimeError('Referência inválida no modelo de tradução.')
    progress('Otimizando o tradutor para este computador. Isso acontece uma vez…')
    OpusMTConverter(str(raw)).convert(str(target), quantization='int8', force=True)
    for filename in ('source.spm', 'target.spm'):
        shutil.copyfile(raw / filename, target / filename)
    with archive.open('rb') as handle:
        checksum = hashlib.file_digest(handle, 'sha256').hexdigest()
    metadata = {'source': MODEL_URL, 'target': 'pt-BR', 'license': 'Apache-2.0',
                'archive_sha256': checksum}
    (target / 'ktalk.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    return target


class LocalTranslator:
    def __init__(self, directory: Path):
        import ctranslate2
        import sentencepiece as spm
        self.source = spm.SentencePieceProcessor(model_file=str(directory / 'source.spm'))
        self.target = spm.SentencePieceProcessor(model_file=str(directory / 'target.spm'))
        vocabulary = json.loads((directory / 'shared_vocabulary.json').read_text(encoding='utf-8')) if (directory / 'shared_vocabulary.json').exists() else json.loads((directory / 'source_vocabulary.json').read_text(encoding='utf-8'))
        self.language_token = next((token for token in ('>>pt_BR<<', '>>pt_br<<') if token in vocabulary), None)
        if self.language_token is None:
            raise RuntimeError('O tradutor instalado não contém o destino PT-BR.')
        self.model = ctranslate2.Translator(str(directory), device='cpu', compute_type='int8',
                                           inter_threads=1, intra_threads=max(1, min(4, (os.cpu_count() or 4) // 2)))
        self.cache = {}

    def translate(self, text: str, final=True) -> str:
        text = unicodedata.normalize('NFKC', text).strip()
        if not text:
            return ''
        key = (text, final)
        if key in self.cache:
            return self.cache[key]
        tokens = [self.language_token] + self.source.encode(text, out_type=str)
        result = self.model.translate_batch([tokens], beam_size=2 if final else 1,
            max_decoding_length=min(180, max(24, len(tokens) * 3)),
            repetition_penalty=1.1, no_repeat_ngram_size=4)[0]
        translated = self.target.decode(result.hypotheses[0]).strip()
        self.cache[key] = translated
        if len(self.cache) > 128:
            self.cache.pop(next(iter(self.cache)))
        return translated
